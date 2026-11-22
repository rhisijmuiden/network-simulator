import { sql } from "./db.js";

export type Actor = { id: number; username: string } | null;

export async function audit(actor: Actor, action: string, detail: Record<string, unknown> = {}, ip = ""): Promise<void> {
  await sql`
    INSERT INTO audit_log (user_id, username, action, detail, ip)
    VALUES (${actor?.id ?? null}, ${actor?.username ?? "system"}, ${action}, ${sql.json(detail as never)}, ${ip})`;
}
