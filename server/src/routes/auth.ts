import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import {
  createSession,
  destroySession,
  destroyUserSessions,
  hashPassword,
  passwordProblem,
  SESSION_COOKIE,
  setSessionCookie,
  toSessionUser,
  verifyPassword,
} from "../auth.js";
import { sql } from "../db.js";

const Login = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(500) });
const ChangePassword = z.object({ current: z.string().max(500), next: z.string().max(500) });
const Profile = z.object({
  displayName: z.string().max(100),
  email: z.union([z.literal(""), z.string().email().max(200)]),
  language: z.enum(["en", "nl"]),
});

// Constant-time-ish answer when the user does not exist.
const DUMMY_HASH = await hashPassword("not-a-real-password-0");

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = Login.parse(req.body);
    const rows = await sql`
      SELECT id, username, display_name, email, role, language, must_change_password, password_hash, disabled
      FROM users WHERE lower(username) = lower(${body.username})`;
    const row = rows[0];
    const ok = await verifyPassword(row?.password_hash ?? DUMMY_HASH, body.password);
    if (!row || !ok || row.disabled) {
      await audit(null, "auth.loginFailed", { username: body.username }, req.ip);
      return reply.code(401).send({ error: "auth.invalidCredentials" });
    }
    const token = await createSession(row.id, req);
    setSessionCookie(reply, req, token);
    await audit({ id: row.id, username: row.username }, "auth.login", {}, req.ip);
    return { user: toSessionUser(row as never) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "auth.required" });
    return { user: req.user };
  });

  app.post("/api/auth/password", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "auth.required" });
    const body = ChangePassword.parse(req.body);
    const [row] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${req.user.id}`;
    if (!row || !(await verifyPassword(row.password_hash, body.current))) return reply.code(400).send({ error: "password.currentWrong" });
    const problem = passwordProblem(body.next);
    if (problem) return reply.code(400).send({ error: problem });
    if (body.next === body.current) return reply.code(400).send({ error: "password.same" });
    await sql`UPDATE users SET password_hash = ${await hashPassword(body.next)}, must_change_password = false WHERE id = ${req.user.id}`;
    await destroyUserSessions(req.user.id, req.cookies[SESSION_COOKIE]);
    await audit(req.user, "auth.passwordChanged", {}, req.ip);
    return { ok: true };
  });

  app.put("/api/auth/profile", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "auth.required" });
    const body = Profile.parse(req.body);
    await sql`UPDATE users SET display_name = ${body.displayName}, email = ${body.email}, language = ${body.language} WHERE id = ${req.user.id}`;
    return { ok: true };
  });
}
