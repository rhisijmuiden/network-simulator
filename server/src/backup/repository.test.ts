import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Backend } from "./backends.js";
import { chunkStream, MAX_CHUNK, MIN_CHUNK } from "./chunker.js";
import { rewrapRepo, unlockRepo } from "./crypto.js";
import { applyRetention, createBackup, downloadBackup, listBackups, openRepo, readRepoConfig, writeRepoConfig, type Source } from "./repository.js";

class MemoryBackend implements Backend {
  files = new Map<string, Buffer>();
  async put(p: string, d: Buffer) {
    this.files.set(p, Buffer.from(d));
  }
  async get(p: string) {
    const v = this.files.get(p);
    if (!v) throw new Error("not found");
    return v;
  }
  async list(dir: string) {
    const prefix = dir.endsWith("/") ? dir : dir + "/";
    const names = new Set<string>();
    for (const k of this.files.keys()) if (k.startsWith(prefix)) names.add(k.slice(prefix.length).split("/")[0]!);
    return [...names];
  }
  async remove(p: string) {
    this.files.delete(p);
  }
  async removeDir(dir: string) {
    for (const k of [...this.files.keys()]) if (k.startsWith(dir + "/")) this.files.delete(k);
  }
  async close() {}
  fingerprint() {
    return "";
  }
}

const meta = { appVersion: "0.1.0", schemaVersion: 1, hostname: "test" };
const src = (path: string, data: Buffer): Source => ({ path, mode: 0o600, open: () => Readable.from([data]) });

describe("chunker", () => {
  it("splits within bounds and reassembles exactly", async () => {
    const data = randomBytes(9 * 1024 * 1024);
    const parts: Buffer[] = [];
    for await (const c of chunkStream(Readable.from([data.subarray(0, 3_000_000), data.subarray(3_000_000)]))) parts.push(Buffer.from(c));
    expect(Buffer.concat(parts).equals(data)).toBe(true);
    for (const p of parts.slice(0, -1)) {
      expect(p.length).toBeGreaterThanOrEqual(MIN_CHUNK);
      expect(p.length).toBeLessThanOrEqual(MAX_CHUNK);
    }
  });
});

describe("repository", () => {
  it("makes full and incremental backups that restore on their own", async () => {
    const b = new MemoryBackend();
    const keys = await openRepo(b, "correct horse battery", true);
    const db1 = randomBytes(16 * 1024 * 1024);
    const full = await createBackup(b, keys, [src("database.sql", db1), src("files/secret.key", Buffer.from("k1"))], { kind: "full", ...meta });
    expect(full.manifest.kind).toBe("full");

    // Change a little in the middle: an incremental uploads far less than the whole.
    const db2 = Buffer.concat([db1.subarray(0, 8_000_000), Buffer.from("INSERT 1;"), db1.subarray(8_000_000)]);
    const inc = await createBackup(b, keys, [src("database.sql", db2), src("files/secret.key", Buffer.from("k1"))], { kind: "incremental", ...meta });
    expect(inc.manifest.kind).toBe("incremental");
    expect(inc.manifest.chainId).toBe(full.manifest.chainId);
    expect(inc.uploadedBytes).toBeLessThan(full.uploadedBytes / 3);

    const list = await listBackups(b, keys);
    expect(list.map((l) => l.id).sort()).toEqual([full.manifest.id, inc.manifest.id].sort());

    const dest = await mkdtemp(join(tmpdir(), "netsim-restore-"));
    await downloadBackup(b, keys, inc.manifest.chainId, inc.manifest.id, dest);
    expect((await readFile(join(dest, "database.sql"))).equals(db2)).toBe(true);
    expect((await readFile(join(dest, "files/secret.key"))).toString()).toBe("k1");
  });

  it("rejects a wrong passphrase and keeps backups readable after a passphrase change", async () => {
    const b = new MemoryBackend();
    const keys = await openRepo(b, "first passphrase", true);
    const r = await createBackup(b, keys, [src("database.sql", Buffer.from("hello"))], { kind: "full", ...meta });
    await expect(openRepo(b, "wrong passphrase", false)).rejects.toThrow("backup.wrongPassphrase");
    const cfg = (await readRepoConfig(b))!;
    await writeRepoConfig(b, await rewrapRepo(cfg, "first passphrase", "second passphrase"));
    const keys2 = await unlockRepo((await readRepoConfig(b))!, "second passphrase");
    const dest = await mkdtemp(join(tmpdir(), "netsim-restore-"));
    await downloadBackup(b, keys2, r.manifest.chainId, r.manifest.id, dest);
    expect((await readFile(join(dest, "database.sql"))).toString()).toBe("hello");
  });

  it("detects tampered chunks", async () => {
    const b = new MemoryBackend();
    const keys = await openRepo(b, "passphrase here", true);
    const r = await createBackup(b, keys, [src("database.sql", randomBytes(1000))], { kind: "full", ...meta });
    const chunkPath = [...b.files.keys()].find((k) => k.includes("/chunks/"))!;
    const tampered = Buffer.from(b.files.get(chunkPath)!);
    tampered[tampered.length - 1]! ^= 1;
    b.files.set(chunkPath, tampered);
    const dest = await mkdtemp(join(tmpdir(), "netsim-restore-"));
    await expect(downloadBackup(b, keys, r.manifest.chainId, r.manifest.id, dest)).rejects.toThrow();
  });

  it("keeps the newest chains", async () => {
    const b = new MemoryBackend();
    const keys = await openRepo(b, "passphrase here", true);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await createBackup(b, keys, [src("database.sql", Buffer.from(`v${i}`))], { kind: "full", ...meta })).manifest.chainId);
      await new Promise((r) => setTimeout(r, 1100)); // ids are per second
    }
    expect(await applyRetention(b, 2)).toEqual([ids[0]]);
    expect((await listBackups(b, keys)).length).toBe(2);
  });
});
