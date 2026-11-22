import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import type { Readable } from "node:stream";
import type { Backend } from "./backends.js";
import { chunkStream } from "./chunker.js";
import { chunkId, decryptBlob, encryptBlob, newRepoConfig, unlockRepo, type Keys, type RepoConfig } from "./crypto.js";

/**
 * Layout at a backup location:
 *
 *   netsim-backup.json                       repository config (wrapped key, KDF)
 *   chains/<chainId>/chunks/<chunkId>        encrypted, compressed chunks
 *   chains/<chainId>/manifests/<backupId>    encrypted manifest of one backup
 *
 * A chain starts with a full backup. Incremental backups in the same chain only
 * upload chunks the chain does not have yet, but every manifest lists all chunks,
 * so any backup restores on its own. Retention removes whole chains.
 */
const CONFIG_FILE = "netsim-backup.json";

export type Source = { path: string; mode: number; open: () => Readable };

export type ManifestFile = { path: string; size: number; mode: number; sha256: string; chunks: string[] };

export type Manifest = {
  format: 1;
  id: string;
  chainId: string;
  kind: "full" | "incremental";
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  hostname: string;
  totalBytes: number;
  files: ManifestFile[];
};

export type BackupSummary = Omit<Manifest, "files" | "format"> & { fileCount: number };

export type BackupResult = { manifest: Manifest; uploadedBytes: number; uploadedChunks: number };

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
export const newId = () => `${stamp()}-${randomBytes(3).toString("hex")}`;

export async function readRepoConfig(b: Backend): Promise<RepoConfig | null> {
  try {
    return JSON.parse((await b.get(CONFIG_FILE)).toString("utf8")) as RepoConfig;
  } catch {
    return null;
  }
}

export async function writeRepoConfig(b: Backend, cfg: RepoConfig): Promise<void> {
  await b.put(CONFIG_FILE, Buffer.from(JSON.stringify(cfg, null, 2)));
}

/** Opens the repository at a location, creating it when it does not exist yet. */
export async function openRepo(b: Backend, passphrase: string, create: boolean): Promise<Keys> {
  const existing = await readRepoConfig(b);
  if (existing) return unlockRepo(existing, passphrase);
  if (!create) throw new Error("backup.noRepository");
  const { config, keys } = await newRepoConfig(passphrase);
  await writeRepoConfig(b, config);
  return keys;
}

async function chains(b: Backend): Promise<string[]> {
  return (await b.list("chains")).filter((n) => /^[0-9TZ]+-[0-9a-f]+$/.test(n)).sort();
}

export async function createBackup(
  b: Backend,
  keys: Keys,
  sources: Source[],
  meta: { kind: "full" | "incremental"; appVersion: string; schemaVersion: number; hostname: string },
  onProgress: (uploadedBytes: number) => void = () => {},
): Promise<BackupResult> {
  let kind = meta.kind;
  let chainId = "";
  const known = new Set<string>();
  if (kind === "incremental") {
    const all = await chains(b);
    const last = all.at(-1);
    if (last && (await b.list(`chains/${last}/manifests`)).length > 0) {
      chainId = last;
      for (const c of await b.list(`chains/${last}/chunks`)) if (!c.endsWith(".part")) known.add(c);
    } else {
      kind = "full";
    }
  }
  if (!chainId) chainId = newId();

  const manifest: Manifest = {
    format: 1,
    id: newId(),
    chainId,
    kind,
    createdAt: new Date().toISOString(),
    appVersion: meta.appVersion,
    schemaVersion: meta.schemaVersion,
    hostname: meta.hostname,
    totalBytes: 0,
    files: [],
  };
  let uploadedBytes = 0;
  let uploadedChunks = 0;
  for (const src of sources) {
    const file: ManifestFile = { path: src.path, size: 0, mode: src.mode, sha256: "", chunks: [] };
    const sha = createHash("sha256");
    for await (const chunk of chunkStream(src.open())) {
      sha.update(chunk);
      file.size += chunk.length;
      const id = chunkId(keys, chunk);
      file.chunks.push(id);
      if (!known.has(id)) {
        const sealed = encryptBlob(keys, chunk);
        await b.put(`chains/${chainId}/chunks/${id}`, sealed);
        known.add(id);
        uploadedBytes += sealed.length;
        uploadedChunks++;
        onProgress(uploadedBytes);
      }
    }
    file.sha256 = sha.digest("hex");
    manifest.totalBytes += file.size;
    manifest.files.push(file);
  }
  // The manifest is written last: a backup only exists once all its chunks are stored.
  await b.put(`chains/${chainId}/manifests/${manifest.id}`, encryptBlob(keys, Buffer.from(JSON.stringify(manifest))));
  return { manifest, uploadedBytes, uploadedChunks };
}

export async function readManifest(b: Backend, keys: Keys, chainId: string, backupId: string): Promise<Manifest> {
  if (!/^[0-9TZ]+-[0-9a-f]+$/.test(chainId) || !/^[0-9TZ]+-[0-9a-f]+$/.test(backupId)) throw new Error("backup.notFound");
  const m = JSON.parse(decryptBlob(keys, await b.get(`chains/${chainId}/manifests/${backupId}`)).toString("utf8")) as Manifest;
  if (m.format !== 1 || m.id !== backupId || m.chainId !== chainId) throw new Error("backup.corrupt");
  return m;
}

export async function listBackups(b: Backend, keys: Keys): Promise<BackupSummary[]> {
  const out: BackupSummary[] = [];
  for (const chain of await chains(b)) {
    for (const id of (await b.list(`chains/${chain}/manifests`)).filter((n) => !n.endsWith(".part"))) {
      try {
        const { files, format: _f, ...rest } = await readManifest(b, keys, chain, id);
        out.push({ ...rest, fileCount: files.length });
      } catch {
        // unreadable manifest: skip, the restore would fail anyway
      }
    }
  }
  return out.sort((a, b2) => b2.createdAt.localeCompare(a.createdAt));
}

/** Keeps the newest `keep` chains and deletes the rest with all their backups. */
export async function applyRetention(b: Backend, keep: number): Promise<string[]> {
  const all = await chains(b);
  const remove = all.slice(0, Math.max(0, all.length - Math.max(1, keep)));
  for (const c of remove) await b.removeDir(`chains/${c}`);
  return remove;
}

function safeTarget(root: string, rel: string): string {
  const target = normalize(join(root, rel));
  if (!target.startsWith(normalize(root) + sep)) throw new Error("backup.corrupt");
  return target;
}

/** Downloads, decrypts and verifies every file of a backup into dest. Returns the manifest. */
export async function downloadBackup(
  b: Backend,
  keys: Keys,
  chainId: string,
  backupId: string,
  dest: string,
  onProgress: (doneBytes: number, totalBytes: number) => void = () => {},
): Promise<Manifest> {
  const m = await readManifest(b, keys, chainId, backupId);
  let done = 0;
  for (const f of m.files) {
    const target = safeTarget(dest, f.path);
    await mkdir(dirname(target), { recursive: true });
    const out = createWriteStream(target, { mode: f.mode & 0o777 });
    const sha = createHash("sha256");
    for (const id of f.chunks) {
      if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("backup.corrupt");
      const plain = decryptBlob(keys, await b.get(`chains/${chainId}/chunks/${id}`));
      if (chunkId(keys, plain) !== id) throw new Error("backup.corrupt");
      sha.update(plain);
      if (!out.write(plain)) await new Promise<void>((r) => out.once("drain", () => r()));
      done += plain.length;
      onProgress(done, m.totalBytes);
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (sha.digest("hex") !== f.sha256) throw new Error("backup.checksumMismatch");
  }
  return m;
}
