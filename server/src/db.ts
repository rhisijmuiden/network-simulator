import postgres from "postgres";
import { config } from "./config.js";
import { migrations } from "./migrations.js";

export const sql = postgres(config.databaseUrl, {
  max: 10,
  onnotice: () => {},
  transform: { undefined: null },
});

export type Sql = typeof sql;

/** Applies pending migrations in order, each in its own transaction. */
export async function migrate(log: (msg: string) => void = () => {}): Promise<number> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const done = new Set((await sql<{ version: number }[]>`SELECT version FROM schema_migrations`).map((r) => r.version));
  let applied = 0;
  for (const m of migrations) {
    if (done.has(m.version)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(m.up);
      await tx`INSERT INTO schema_migrations (version) VALUES (${m.version})`;
    });
    log(`migration ${m.version} ${m.name} applied`);
    applied++;
  }
  return applied;
}

export function schemaVersion(): number {
  return migrations.reduce((max, m) => Math.max(max, m.version), 0);
}
