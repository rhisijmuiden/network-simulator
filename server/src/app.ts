import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { ZodError } from "zod";
import { SESSION_COOKIE, userForToken } from "./auth.js";
import { buildInfo, config } from "./config.js";
import { sql } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { backupRoutes } from "./routes/backup.js";
import { mailRoutes } from "./routes/mail.js";
import { systemRoutes } from "./routes/system.js";
import { userRoutes } from "./routes/users.js";

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req) => {
    req.user = await userForToken(req.cookies[SESSION_COOKIE]);
  });

  // Basic security headers for the web interface.
  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "same-origin");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "validation", issues: err.issues });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? "server.error" : (err as Error).message });
  });

  /** Used by the updater to confirm the new version is running. */
  app.get("/healthz", async () => {
    let database = "ok";
    try {
      await sql`SELECT 1`;
    } catch {
      database = "error";
    }
    const b = buildInfo();
    return { status: "ok", version: b.version, commit: b.commit, database };
  });

  await app.register(authRoutes);
  await app.register(systemRoutes);
  await app.register(userRoutes);
  await app.register(mailRoutes);
  await app.register(backupRoutes);

  if (existsSync(config.webDir)) {
    await app.register(fastifyStatic, { root: config.webDir, wildcard: false });
    // Single-page app: unknown non-API paths serve index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not.found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
