import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Root of the server package (contains dist/, build-info.json). */
export const serverRoot = join(here, "..");

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export const config = {
  host: env("NETSIM_HOST", "0.0.0.0"),
  port: Number(env("NETSIM_PORT", "8080")),
  databaseUrl: env("DATABASE_URL", "postgres://netsim@localhost/network_simulator"),
  /** Writable state: secret key, backups staging, update and restore requests. */
  dataDir: env("NETSIM_DATA_DIR", join(serverRoot, "data")),
  /** Static files of the web interface. */
  webDir: env("NETSIM_WEB_DIR", join(serverRoot, "..", "web", "dist")),
  /** GitHub repository used for update checks: owner/name. */
  updateRepo: env("NETSIM_UPDATE_REPO", "rhisijmuiden/network-simulator"),
  /** Optional GitHub token for a private repository (read-only, contents). */
  updateToken: env("NETSIM_UPDATE_TOKEN", ""),
  /** Written by the privileged updater, read-only for the app. */
  updateStatusFile: env("NETSIM_UPDATE_STATUS", "/var/lib/network-simulator-update/status.json"),
  /** Trust X-Forwarded-* headers from a reverse proxy. */
  trustProxy: env("NETSIM_TRUST_PROXY", "true") === "true",
  /** pg_dump and psql binaries used by backup and restore. */
  pgDump: env("NETSIM_PG_DUMP", "pg_dump"),
  psql: env("NETSIM_PSQL", "psql"),
};

export type BuildInfo = { version: string; commit: string; branch: string; builtAt: string };

export function buildInfo(): BuildInfo {
  try {
    return JSON.parse(readFileSync(join(serverRoot, "build-info.json"), "utf8")) as BuildInfo;
  } catch {
    const pkg = JSON.parse(readFileSync(join(serverRoot, "..", "package.json"), "utf8")) as { version: string };
    return { version: pkg.version, commit: "development", branch: "development", builtAt: "" };
  }
}
