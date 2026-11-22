import { buildApp } from "./app.js";
import { deleteExpiredSessions } from "./auth.js";
import { scheduleTick } from "./backup/engine.js";
import { buildInfo, config } from "./config.js";
import { migrate, sql } from "./db.js";

const app = await buildApp();
await migrate((m) => app.log.info(m));
// Backups that were running when the server stopped will never finish.
await sql`UPDATE backup_runs SET status = 'failed', finished_at = now(), message = 'interrupted: the server stopped during the backup' WHERE status = 'running'`;
await app.listen({ host: config.host, port: config.port });
const b = buildInfo();
app.log.info(`Network Simulator ${b.version} (${b.branch} ${b.commit.slice(0, 7)}) listening on ${config.host}:${config.port}`);

setInterval(() => {
  scheduleTick().catch((err) => app.log.error({ err }, "backup schedule"));
}, 60_000).unref();
setInterval(() => {
  deleteExpiredSessions().catch(() => {});
}, 3600_000).unref();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void app.close().then(() => process.exit(0));
  });
}
