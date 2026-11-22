import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { destroyUserSessions, hashPassword, passwordProblem, randomPassword, requireAdmin } from "../auth.js";
import { sql } from "../db.js";

const UserInput = z.object({
  username: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9._@-]+$/),
  displayName: z.string().max(100).default(""),
  email: z.union([z.literal(""), z.string().email().max(200)]).default(""),
  role: z.enum(["admin", "instructor", "student"]),
  language: z.enum(["en", "nl"]).default("en"),
  disabled: z.boolean().default(false),
  password: z.string().max(500).optional(),
});

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get("/api/users", async () => {
    const rows = await sql`
      SELECT id, username, display_name, email, role, language, disabled, must_change_password, created_at, last_login_at
      FROM users ORDER BY username`;
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      email: r.email,
      role: r.role,
      language: r.language,
      disabled: r.disabled,
      mustChangePassword: r.must_change_password,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
    }));
  });

  app.post("/api/users", async (req, reply) => {
    const body = UserInput.parse(req.body);
    const generated = !body.password;
    const password = body.password || randomPassword();
    const problem = passwordProblem(password);
    if (problem) return reply.code(400).send({ error: problem });
    const exists = await sql`SELECT 1 FROM users WHERE lower(username) = lower(${body.username})`;
    if (exists.length) return reply.code(409).send({ error: "users.exists" });
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO users (username, display_name, email, role, language, disabled, password_hash, must_change_password)
      VALUES (${body.username}, ${body.displayName}, ${body.email}, ${body.role}, ${body.language}, ${body.disabled},
              ${await hashPassword(password)}, true)
      RETURNING id`;
    await audit(req.user, "users.created", { username: body.username, role: body.role }, req.ip);
    return { id: row!.id, oneTimePassword: generated ? password : undefined };
  });

  app.put<{ Params: { id: string } }>("/api/users/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const body = UserInput.omit({ password: true }).parse(req.body);
    if (id === req.user!.id && (body.role !== "admin" || body.disabled)) return reply.code(400).send({ error: "users.cannotDemoteSelf" });
    await sql`
      UPDATE users SET username = ${body.username}, display_name = ${body.displayName}, email = ${body.email},
        role = ${body.role}, language = ${body.language}, disabled = ${body.disabled}
      WHERE id = ${id}`;
    if (body.disabled) await destroyUserSessions(id);
    await audit(req.user, "users.updated", { id, username: body.username }, req.ip);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/users/:id/reset-password", async (req) => {
    const id = Number(req.params.id);
    const password = randomPassword();
    await sql`UPDATE users SET password_hash = ${await hashPassword(password)}, must_change_password = true WHERE id = ${id}`;
    await destroyUserSessions(id);
    await audit(req.user, "users.passwordReset", { id }, req.ip);
    return { oneTimePassword: password };
  });

  app.delete<{ Params: { id: string } }>("/api/users/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (id === req.user!.id) return reply.code(400).send({ error: "users.cannotDeleteSelf" });
    await sql`DELETE FROM users WHERE id = ${id}`;
    await audit(req.user, "users.deleted", { id }, req.ip);
    return { ok: true };
  });

  app.get<{ Querystring: { limit?: string } }>("/api/audit", async (req) => {
    const limit = Math.min(500, Number(req.query.limit ?? 200) || 200);
    return sql`SELECT id, at, username, action, detail, ip FROM audit_log ORDER BY at DESC LIMIT ${limit}`;
  });
}
