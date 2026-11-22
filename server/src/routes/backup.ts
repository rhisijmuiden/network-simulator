import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { requireAdmin } from "../auth.js";
import { sql } from "../db.js";
import { FingerprintError, openBackend, type Backend } from "../backup/backends.js";
import { rewrapRepo } from "../backup/crypto.js";
import {
  backupRunning,
  getLocation,
  getSchedule,
  locationConfig,
  restoreStatus,
  runBackup,
  stageRestore,
  type LocationRow,
} from "../backup/engine.js";
import { listBackups, openRepo, readRepoConfig, writeRepoConfig } from "../backup/repository.js";
import { decryptSecret, encryptSecret } from "../secrets.js";
import { setSetting } from "../settings.js";

const LocationInput = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(["ftp", "ftps", "scp"]),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255),
  /** Password or private key. Empty keeps the stored one. */
  secret: z.string().max(20000),
  keyPassphrase: z.string().max(1000).default(""),
  path: z.string().trim().max(500),
  enabled: z.boolean().default(true),
  options: z
    .object({
      implicitTls: z.boolean().optional(),
      verifyCertificate: z.boolean().optional(),
      tlsFingerprint: z.string().max(200).optional(),
      hostKeyFingerprint: z.string().max(200).optional(),
      authType: z.enum(["password", "key"]).optional(),
    })
    .default({}),
});
type LocationInput = z.infer<typeof LocationInput>;

const ScheduleInput = z.object({
  enabled: z.boolean(),
  intervalHours: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(6), z.literal(12), z.literal(24)]),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  fullEveryDays: z.number().int().min(1).max(90),
  keepChains: z.number().int().min(1).max(100),
});

function publicLocation(r: LocationRow) {
  const { keyPassphrase: _k, ...options } = r.options;
  return { id: r.id, name: r.name, type: r.type, host: r.host, port: r.port, username: r.username, path: r.path, enabled: r.enabled, options, secretSet: r.secret !== "" };
}

/** Builds a stored location row from form input, keeping stored secrets when the field is empty. */
function toRow(input: LocationInput, stored?: LocationRow): Omit<LocationRow, "id" | "enabled" | "name"> {
  // Fingerprints are pinned through /trust; keep the stored ones when the form does not send them.
  const options = {
    hostKeyFingerprint: stored?.options.hostKeyFingerprint,
    tlsFingerprint: stored?.options.tlsFingerprint,
    ...input.options,
  } as LocationRow["options"];
  if (!options.hostKeyFingerprint) delete options.hostKeyFingerprint;
  if (!options.tlsFingerprint) delete options.tlsFingerprint;
  if (input.type === "scp" && input.options.authType === "key") {
    options.keyPassphrase = input.keyPassphrase ? encryptSecret(input.keyPassphrase) : stored?.options.keyPassphrase;
  }
  // A changed server invalidates the pinned fingerprints.
  if (stored && (stored.host !== input.host || stored.port !== input.port || stored.type !== input.type)) {
    delete options.hostKeyFingerprint;
    delete options.tlsFingerprint;
  }
  return {
    type: input.type,
    host: input.host,
    port: input.port,
    username: input.username,
    secret: input.secret ? encryptSecret(input.secret) : (stored?.secret ?? ""),
    path: input.path,
    options,
  };
}

async function withBackend<T>(row: Omit<LocationRow, "id" | "enabled" | "name">, fn: (b: Backend) => Promise<T>): Promise<T> {
  const b = await openBackend(locationConfig(row));
  try {
    return await fn(b);
  } finally {
    await b.close().catch(() => {});
  }
}

function errorBody(err: unknown) {
  if (err instanceof FingerprintError) return { error: err.message, fingerprint: err.fingerprint };
  return { error: "backup.connectionFailed", detail: err instanceof Error ? err.message : String(err) };
}

export async function backupRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  /* ----- locations */

  app.get("/api/backup/locations", async () => {
    const rows = await sql<LocationRow[]>`SELECT * FROM backup_locations ORDER BY name`;
    return rows.map(publicLocation);
  });

  app.post("/api/backup/locations", async (req) => {
    const input = LocationInput.parse(req.body);
    const row = toRow(input);
    const [created] = await sql<{ id: number }[]>`
      INSERT INTO backup_locations (name, type, host, port, username, secret, path, options, enabled)
      VALUES (${input.name}, ${row.type}, ${row.host}, ${row.port}, ${row.username}, ${row.secret}, ${row.path},
              ${sql.json(row.options as never)}, ${input.enabled})
      RETURNING id`;
    await audit(req.user, "backup.locationCreated", { name: input.name, type: input.type, host: input.host }, req.ip);
    return { id: created!.id };
  });

  app.put<{ Params: { id: string } }>("/api/backup/locations/:id", async (req) => {
    const stored = await getLocation(Number(req.params.id));
    const input = LocationInput.parse(req.body);
    const row = toRow(input, stored);
    await sql`
      UPDATE backup_locations SET name = ${input.name}, type = ${row.type}, host = ${row.host}, port = ${row.port},
        username = ${row.username}, secret = ${row.secret}, path = ${row.path}, options = ${sql.json(row.options as never)},
        enabled = ${input.enabled}
      WHERE id = ${stored.id}`;
    await audit(req.user, "backup.locationUpdated", { name: input.name }, req.ip);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/backup/locations/:id", async (req) => {
    const stored = await getLocation(Number(req.params.id));
    await sql`DELETE FROM backup_locations WHERE id = ${stored.id}`;
    await audit(req.user, "backup.locationDeleted", { name: stored.name }, req.ip);
    return { ok: true };
  });

  /** Tests a location from the form: connect, write, read and delete a test file, look for backups. */
  app.post("/api/backup/locations/test", async (req, reply) => {
    const body = z.object({ id: z.number().int().optional(), location: LocationInput }).parse(req.body);
    const stored = body.id ? await getLocation(body.id) : undefined;
    const row = toRow(body.location, stored);
    try {
      const result = await withBackend(row, async (b) => {
        const probe = `.netsim-test-${Date.now()}`;
        await b.put(probe, Buffer.from("ok"));
        const back = (await b.get(probe)).toString();
        await b.remove(probe);
        if (back !== "ok") throw new Error("read back failed");
        const repo = await readRepoConfig(b);
        return { fingerprint: b.fingerprint(), repositoryFound: Boolean(repo) };
      });
      return { ok: true, ...result };
    } catch (err) {
      return reply.code(400).send(errorBody(err));
    }
  });

  /** Pins the fingerprint the user compared and accepted. */
  app.post<{ Params: { id: string } }>("/api/backup/locations/:id/trust", async (req) => {
    const { fingerprint } = z.object({ fingerprint: z.string().min(10).max(200) }).parse(req.body);
    const stored = await getLocation(Number(req.params.id));
    const options = { ...stored.options };
    if (stored.type === "scp") options.hostKeyFingerprint = fingerprint;
    else options.tlsFingerprint = fingerprint;
    await sql`UPDATE backup_locations SET options = ${sql.json(options as never)} WHERE id = ${stored.id}`;
    await audit(req.user, "backup.fingerprintTrusted", { name: stored.name, fingerprint }, req.ip);
    return { ok: true };
  });

  /* ----- schedule and passphrase */

  app.get("/api/backup/schedule", async () => {
    const { passphrase, ...s } = await getSchedule();
    return { ...s, passphraseSet: passphrase !== "" };
  });

  app.put("/api/backup/schedule", async (req) => {
    const input = ScheduleInput.parse(req.body);
    const current = await getSchedule();
    await setSetting("backup", { ...current, ...input });
    await audit(req.user, "backup.scheduleUpdated", input, req.ip);
    return { ok: true };
  });

  /** Sets the passphrase, or changes it and re-wraps the key at every reachable location. */
  app.put("/api/backup/passphrase", async (req, reply) => {
    const body = z.object({ current: z.string().max(500).default(""), next: z.string().min(12).max(500) }).parse(req.body);
    const s = await getSchedule();
    const failed: string[] = [];
    if (s.passphrase) {
      if (decryptSecret(s.passphrase) !== body.current) return reply.code(400).send({ error: "backup.wrongPassphrase" });
      const locations = await sql<LocationRow[]>`SELECT * FROM backup_locations`;
      for (const loc of locations) {
        try {
          await withBackend(loc, async (b) => {
            const cfg = await readRepoConfig(b);
            if (cfg) await writeRepoConfig(b, await rewrapRepo(cfg, body.current, body.next));
          });
        } catch {
          failed.push(loc.name);
        }
      }
    }
    await setSetting("backup", { ...s, passphrase: encryptSecret(body.next) });
    await audit(req.user, "backup.passphraseChanged", { unreachable: failed }, req.ip);
    return { ok: true, unreachable: failed };
  });

  /* ----- run and history */

  app.post("/api/backup/run", async (req, reply) => {
    const body = z.object({ locationId: z.number().int(), kind: z.enum(["full", "incremental"]) }).parse(req.body);
    try {
      const runId = await runBackup(body.locationId, body.kind, "manual", req.user);
      await audit(req.user, "backup.started", { locationId: body.locationId, kind: body.kind }, req.ip);
      return { runId };
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/backup/runs", async () => {
    const rows = await sql`SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 100`;
    return { running: backupRunning(), runs: rows };
  });

  /* ----- restore */

  const RestoreSource = z.object({
    locationId: z.number().int().optional(),
    /** Another location that is not configured here (disaster recovery). */
    location: LocationInput.optional(),
    passphrase: z.string().max(500).optional(),
  });

  async function resolveSource(src: z.infer<typeof RestoreSource>) {
    const s = await getSchedule();
    const pass = src.passphrase || (s.passphrase ? decryptSecret(s.passphrase) : "");
    if (!pass) throw new Error("backup.noPassphrase");
    if (src.locationId) return { row: await getLocation(src.locationId), pass };
    if (src.location) return { row: toRow(src.location), pass };
    throw new Error("backup.locationNotFound");
  }

  app.post("/api/backup/available", async (req, reply) => {
    try {
      const { row, pass } = await resolveSource(RestoreSource.parse(req.body));
      return await withBackend(row, async (b) => listBackups(b, await openRepo(b, pass, false)));
    } catch (err) {
      if (err instanceof FingerprintError) return reply.code(400).send(errorBody(err));
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/backup/restore", async (req, reply) => {
    const body = RestoreSource.extend({ chainId: z.string().max(64), backupId: z.string().max(64), confirm: z.literal("RESTORE") }).parse(req.body);
    try {
      const { row, pass } = await resolveSource(body);
      await stageRestore(row, pass, body.chainId, body.backupId, req.user);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/backup/restore/status", async () => restoreStatus());
}
