import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sql } from "./db.js";

export type Role = "admin" | "instructor" | "student";

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  email: string;
  role: Role;
  language: "en" | "nl";
  mustChangePassword: boolean;
};

export const SESSION_COOKIE = "netsim_session";
const SESSION_DAYS = 14;

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** Strong enough for a lab platform: 10+ characters, not only letters or digits. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "password.tooShort";
  if (/^[a-zA-Z]+$/.test(password) || /^\d+$/.test(password)) return "password.tooSimple";
  return null;
}

export function randomPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const tokenId = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: number, req: FastifyRequest): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await sql`
    INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
    VALUES (${tokenId(token)}, ${userId}, now() + ${SESSION_DAYS + " days"}::interval, ${req.ip}, ${req.headers["user-agent"] ?? ""})`;
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${userId}`;
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE id = ${tokenId(token)}`;
}

export async function destroyUserSessions(userId: number, exceptToken?: string): Promise<void> {
  if (exceptToken) await sql`DELETE FROM sessions WHERE user_id = ${userId} AND id <> ${tokenId(exceptToken)}`;
  else await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
}

type UserRow = {
  id: number;
  username: string;
  display_name: string;
  email: string;
  role: Role;
  language: "en" | "nl";
  must_change_password: boolean;
};

export function toSessionUser(r: UserRow): SessionUser {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    email: r.email,
    role: r.role,
    language: r.language,
    mustChangePassword: r.must_change_password,
  };
}

export async function userForToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await sql<UserRow[]>`
    SELECT u.id, u.username, u.display_name, u.email, u.role, u.language, u.must_change_password
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ${tokenId(token)} AND s.expires_at > now() AND NOT u.disabled`;
  return rows[0] ? toSessionUser(rows[0]) : null;
}

export function setSessionCookie(reply: FastifyReply, req: FastifyRequest, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: req.protocol === "https",
    maxAge: SESSION_DAYS * 86400,
  });
}

/** Route guard: signed in, password changed, and (optionally) one of the roles. */
export function requireUser(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "auth.required" });
    if (req.user.mustChangePassword) return reply.code(403).send({ error: "auth.passwordChangeRequired" });
    if (roles.length && !roles.includes(req.user.role)) return reply.code(403).send({ error: "auth.forbidden" });
  };
}

export const requireAdmin = requireUser("admin");

export async function deleteExpiredSessions(): Promise<void> {
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
}
