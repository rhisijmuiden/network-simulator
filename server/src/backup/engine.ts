import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, relative } from "node:path";
import { audit, type Actor } from "../audit.js";
import { buildInfo, config } from "../config.js";
import { migrate, schemaVersion, sql } from "../db.js";
import { notifyAdmins } from "../mail.js";
import { decryptSecret, resetSecretKey } from "../secrets.js";
import { getSetting } from "../settings.js";
import { openBackend, type Backend, type LocationConfig, type LocationOptions, type LocationType } from "./backends.js";
import { applyRetention, createBackup, downloadBackup, openRepo, type Manifest, type Source } from "./repository.js";

export type BackupSchedule = {
  enabled: boolean;
  /** Hours between backups: 1, 2, 4, 6, 12 or 24. */
  intervalHours: number;
  /** First backup of the day, HH:MM local time. */
  startTime: string;
  /** A new full backup (new chain) every N days. */
  fullEveryDays: number;
  /** Number of chains (full backups with their incrementals) to keep per location. */
  keepChains: number;
  /** Encrypted backup passphrase. */
  passphrase: string;
};

export const defaultSchedule: BackupSchedule = {
  enabled: false,
  intervalHours: 24,
  startTime: "02:00",
  fullEveryDays: 7,
  keepChains: 4,
  passphrase: "",
};

export const getSchedule = () => getSetting("backup", defaultSchedule);

export type LocationRow = {
  id: number;
  name: string;
  type: LocationType;
  host: string;
  port: number;
  username: string;
  secret: string;
  path: string;
  options: LocationOptions & { keyPassphrase?: string };
  enabled: boolean;
};

export function locationConfig(row: Omit<LocationRow, "id" | "name" | "enabled">): LocationConfig {
  return {
    type: row.type,
    host: row.host,
    port: row.port,
    username: row.username,
    secret: decryptSecret(row.secret),
    passphrase: row.options.keyPassphrase ? decryptSecret(row.options.keyPassphrase) : undefined,
    path: row.path,
    options: row.options,
  };
}

export async function getLocation(id: number): Promise<LocationRow> {
  const rows = await sql<LocationRow[]>`SELECT * FROM backup_locations WHERE id = ${id}`;
  if (!rows[0]) throw new Error("backup.locationNotFound");
  return rows[0];
}

const dirs = () => ({
  tmp: join(config.dataDir, "tmp"),
  restore: join(config.dataDir, "restore"),
});

/** Paths under the data directory that never go into a backup. */
const EXCLUDED = new Set(["tmp", "restore", "update", "node-compile-cache"]);

async function walk(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (dir === root && EXCLUDED.has(e.name)) continue;
    if (e.isDirectory()) out.push(...(await walk(root, full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function run(cmd: string, args: string[], opts: { input?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} failed: ${err.trim() || `exit ${code}`}`))));
    p.stdin.end(opts.input ?? "");
  });
}

/** Dumps the database (without sessions) to a file. */
export async function dumpDatabase(target: string): Promise<void> {
  await run(config.pgDump, [
    `--dbname=${config.databaseUrl}`,
    "--format=plain",
    "--no-owner",
    "--no-privileges",
    "--exclude-table-data=sessions",
    `--file=${target}`,
  ]);
}

async function collectSources(dumpFile: string): Promise<Source[]> {
  const sources: Source[] = [{ path: "database.sql", mode: 0o600, open: () => createReadStream(dumpFile) }];
  for (const file of await walk(config.dataDir)) {
    const st = await stat(file);
    sources.push({ path: "files/" + relative(config.dataDir, file), mode: st.mode & 0o777, open: () => createReadStream(file) });
  }
  return sources;
}

async function passphrase(): Promise<string> {
  const s = await getSchedule();
  if (!s.passphrase) throw new Error("backup.noPassphrase");
  return decryptSecret(s.passphrase);
}

let running = false;
export const backupRunning = () => running;

/** Runs a backup to one location and records it in the history. */
export async function runBackup(locationId: number, kind: "full" | "incremental", trigger: "manual" | "schedule", actor: Actor): Promise<number> {
  if (running) throw new Error("backup.alreadyRunning");
  running = true;
  const loc = await getLocation(locationId).catch((e) => {
    running = false;
    throw e;
  });
  const [runRow] = await sql<{ id: number }[]>`
    INSERT INTO backup_runs (location_id, location_name, kind, trigger, status)
    VALUES (${loc.id}, ${loc.name}, ${kind}, ${trigger}, 'running') RETURNING id`;
  const runId = runRow!.id;
  // Runs in the background; the UI follows the history.
  void (async () => {
    const { tmp } = dirs();
    const dumpFile = join(tmp, `dump-${runId}.sql`);
    let backend: Backend | null = null;
    try {
      await mkdir(tmp, { recursive: true, mode: 0o700 });
      const pass = await passphrase();
      await dumpDatabase(dumpFile);
      backend = await openBackend(locationConfig(loc));
      const keys = await openRepo(backend, pass, true);
      const sources = await collectSources(dumpFile);
      let last = 0;
      const result = await createBackup(
        backend,
        keys,
        sources,
        { kind, appVersion: buildInfo().version, schemaVersion: schemaVersion(), hostname: hostname() },
        (bytes) => {
          if (bytes - last > 4 * 1024 * 1024) {
            last = bytes;
            void sql`UPDATE backup_runs SET bytes_uploaded = ${bytes} WHERE id = ${runId}`;
          }
        },
      );
      let removed: string[] = [];
      if (result.manifest.kind === "full") removed = await applyRetention(backend, (await getSchedule()).keepChains);
      await sql`
        UPDATE backup_runs SET status = 'success', finished_at = now(), kind = ${result.manifest.kind},
          backup_id = ${result.manifest.id}, chain_id = ${result.manifest.chainId},
          bytes_total = ${result.manifest.totalBytes}, bytes_uploaded = ${result.uploadedBytes},
          message = ${removed.length ? `retention removed ${removed.length} chain(s)` : ""}
        WHERE id = ${runId}`;
      await audit(actor, "backup.completed", { location: loc.name, kind: result.manifest.kind, id: result.manifest.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sql`UPDATE backup_runs SET status = 'failed', finished_at = now(), message = ${message} WHERE id = ${runId}`;
      await audit(actor, "backup.failed", { location: loc.name, error: message });
      await notifyAdmins(
        `Backup failed: ${loc.name}`,
        `The ${kind} backup to "${loc.name}" failed on ${hostname()}.\n\nError: ${message}\n\nOpen Administration > Backup & restore for details.`,
      );
    } finally {
      await backend?.close().catch(() => {});
      await rm(dumpFile, { force: true });
      running = false;
    }
  })();
  return runId;
}

/** Called every minute: starts the scheduled backups that are due. */
export async function scheduleTick(now = new Date()): Promise<void> {
  const s = await getSchedule();
  if (!s.enabled || !s.passphrase || running) return;
  const [h, m] = s.startTime.split(":").map(Number);
  const first = new Date(now);
  first.setHours(h ?? 2, m ?? 0, 0, 0);
  if (first > now) first.setDate(first.getDate() - 1);
  // Latest slot at or before now: first + k * interval.
  const interval = Math.max(1, s.intervalHours) * 3600_000;
  const slot = new Date(first.getTime() + Math.floor((now.getTime() - first.getTime()) / interval) * interval);
  const locations = await sql<{ id: number }[]>`SELECT id FROM backup_locations WHERE enabled ORDER BY id`;
  for (const loc of locations) {
    const [last] = await sql<{ started_at: Date }[]>`
      SELECT started_at FROM backup_runs WHERE location_id = ${loc.id} AND trigger = 'schedule' ORDER BY started_at DESC LIMIT 1`;
    if (last && last.started_at >= slot) continue;
    const [lastFull] = await sql<{ started_at: Date }[]>`
      SELECT started_at FROM backup_runs WHERE location_id = ${loc.id} AND status = 'success' AND kind = 'full' ORDER BY started_at DESC LIMIT 1`;
    const fullDue = !lastFull || now.getTime() - lastFull.started_at.getTime() >= s.fullEveryDays * 86400_000 - 3600_000;
    await runBackup(loc.id, fullDue ? "full" : "incremental", "schedule", null);
    return; // one at a time; the next tick picks up the next location
  }
}

/* ---------------------------------------------------------------- restore */

export type RestoreStatus = {
  state: "idle" | "downloading" | "staged" | "applying" | "completed" | "failed" | "rolled-back";
  message: string;
  backupId?: string;
  createdAt?: string;
  progress?: number;
  updatedAt: string;
};

const statusFile = () => join(dirs().restore, "status.json");

export async function restoreStatus(): Promise<RestoreStatus> {
  try {
    return JSON.parse(await readFile(statusFile(), "utf8")) as RestoreStatus;
  } catch {
    return { state: "idle", message: "", updatedAt: "" };
  }
}

let statusWrites: Promise<void> = Promise.resolve();

/** Writes the status file atomically; writes are queued so progress updates never race. */
function setRestoreStatus(s: Omit<RestoreStatus, "updatedAt">): Promise<void> {
  statusWrites = statusWrites.then(async () => {
    await mkdir(dirs().restore, { recursive: true, mode: 0o700 });
    const tmp = `${statusFile()}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }));
    await rename(tmp, statusFile());
  });
  return statusWrites;
}

/**
 * Downloads and verifies a backup into the staging folder, then asks the
 * privileged helper (network-simulator-restore.path) to stop the server and apply it.
 */
export async function stageRestore(
  loc: Omit<LocationRow, "id" | "name" | "enabled">,
  pass: string,
  chainId: string,
  backupId: string,
  actor: Actor,
): Promise<void> {
  const current = await restoreStatus();
  if (current.state === "downloading" || current.state === "applying") throw new Error("backup.restoreRunning");
  const staging = join(dirs().restore, "staging");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o700 });
  await setRestoreStatus({ state: "downloading", message: "", backupId, progress: 0 });
  void (async () => {
    let backend: Backend | null = null;
    try {
      backend = await openBackend(locationConfig(loc));
      const keys = await openRepo(backend, pass, false);
      let lastPct = -1;
      const m = await downloadBackup(backend, keys, chainId, backupId, staging, (done, total) => {
        const pct = total ? Math.floor((done / total) * 100) : 100;
        if (pct !== lastPct) {
          lastPct = pct;
          void setRestoreStatus({ state: "downloading", message: "", backupId, progress: pct });
        }
      });
      if (m.schemaVersion > schemaVersion()) throw new Error("backup.newerVersion");
      await writeFile(join(staging, "manifest.json"), JSON.stringify(m, null, 2));
      await setRestoreStatus({ state: "staged", message: "", backupId, createdAt: m.createdAt, progress: 100 });
      await audit(actor, "restore.requested", { backupId, createdAt: m.createdAt });
      // The path unit starts the helper as soon as this file exists.
      await writeFile(join(dirs().restore, "request.json"), JSON.stringify({ backupId, requestedAt: new Date().toISOString() }));
    } catch (err) {
      await rm(staging, { recursive: true, force: true });
      await setRestoreStatus({ state: "failed", message: err instanceof Error ? err.message : String(err), backupId });
    } finally {
      await backend?.close().catch(() => {});
    }
  })();
}

async function restoreDatabase(dumpFile: string): Promise<void> {
  await run(config.psql, [
    `--dbname=${config.databaseUrl}`,
    "--single-transaction",
    "--quiet",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "DROP SCHEMA public CASCADE",
    "-c",
    "CREATE SCHEMA public",
    "-f",
    dumpFile,
  ]);
}

async function replaceFiles(fromDir: string): Promise<void> {
  for (const file of await walk(config.dataDir)) await rm(file, { force: true });
  if (existsSync(fromDir)) await cp(fromDir, config.dataDir, { recursive: true, force: true });
  resetSecretKey();
}

/**
 * Applies the staged backup. Runs from the CLI while the server is stopped
 * (started by network-simulator-restore.service). Keeps a rollback copy and
 * puts it back when anything fails.
 */
export async function applyStagedRestore(log: (msg: string) => void): Promise<boolean> {
  const { restore } = dirs();
  const staging = join(restore, "staging");
  const rollback = join(restore, "rollback");
  await rm(join(restore, "request.json"), { force: true });
  if (!existsSync(join(staging, "manifest.json"))) {
    log("no staged backup");
    return false;
  }
  const m = JSON.parse(await readFile(join(staging, "manifest.json"), "utf8")) as Manifest;
  await setRestoreStatus({ state: "applying", message: "", backupId: m.id, createdAt: m.createdAt });
  log(`restoring backup ${m.id} from ${m.createdAt}`);
  await rm(rollback, { recursive: true, force: true });
  await mkdir(join(rollback, "files"), { recursive: true, mode: 0o700 });
  await dumpDatabase(join(rollback, "database.sql"));
  for (const file of await walk(config.dataDir)) {
    const target = join(rollback, "files", relative(config.dataDir, file));
    await cp(file, target, { force: true });
  }
  try {
    await restoreDatabase(join(staging, "database.sql"));
    await replaceFiles(join(staging, "files"));
    await migrate(log);
    await sql`DELETE FROM sessions`;
    await setRestoreStatus({ state: "completed", message: "", backupId: m.id, createdAt: m.createdAt });
    log("restore completed");
    await rm(staging, { recursive: true, force: true });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`restore failed: ${message}; rolling back`);
    try {
      await restoreDatabase(join(rollback, "database.sql"));
      await replaceFiles(join(rollback, "files"));
      await setRestoreStatus({ state: "rolled-back", message, backupId: m.id, createdAt: m.createdAt });
    } catch (err2) {
      await setRestoreStatus({ state: "failed", message: `${message}; rollback failed: ${String(err2)}`, backupId: m.id });
    }
    return false;
  }
}

