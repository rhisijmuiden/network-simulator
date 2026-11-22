/**
 * Command line tool, used by the installer, the updater and the restore helper.
 *
 *   node server/dist/cli.js migrate
 *   node server/dist/cli.js create-admin <username>     prints a one-time password
 *   node server/dist/cli.js reset-admin [username]      prints a new one-time password
 *   node server/dist/cli.js restore-apply              applies a staged restore (server stopped)
 *   node server/dist/cli.js version
 */
import { hashPassword, randomPassword } from "./auth.js";
import { applyStagedRestore } from "./backup/engine.js";
import { buildInfo } from "./config.js";
import { migrate, sql } from "./db.js";

const [cmd, arg] = process.argv.slice(2);
const log = (m: string) => console.log(m);

async function main(): Promise<number> {
  switch (cmd) {
    case "migrate":
      log(`${await migrate(log)} migration(s) applied`);
      return 0;
    case "create-admin":
    case "reset-admin": {
      await migrate();
      const username = arg || "admin";
      const password = randomPassword();
      const hash = await hashPassword(password);
      const rows = await sql`
        INSERT INTO users (username, display_name, role, password_hash, must_change_password)
        VALUES (${username}, 'Administrator', 'admin', ${hash}, true)
        ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = true, disabled = false, role = 'admin'
        RETURNING id`;
      await sql`DELETE FROM sessions WHERE user_id = ${rows[0]!.id}`;
      log(`User:     ${username}`);
      log(`Password: ${password}`);
      log("You choose a new password at the first sign-in.");
      return 0;
    }
    case "restore-apply":
      return (await applyStagedRestore(log)) ? 0 : 1;
    case "version": {
      const b = buildInfo();
      log(`network-simulator ${b.version} ${b.branch} ${b.commit}`);
      return 0;
    }
    default:
      console.error("usage: cli.js migrate | create-admin <user> | reset-admin [user] | restore-apply | version");
      return 2;
  }
}

const code = await main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  return 1;
});
await sql.end({ timeout: 5 });
process.exit(code);
