import { sql } from "./db.js";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await sql<{ value: T }[]>`SELECT value FROM settings WHERE key = ${key}`;
  return rows[0] ? { ...fallback, ...rows[0].value } : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await sql`
    INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${sql.json(value as never)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}
