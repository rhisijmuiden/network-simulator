import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

/**
 * Backup encryption. A random 256-bit data key encrypts every chunk and manifest
 * with AES-256-GCM after zstd compression. The data key itself is wrapped with a
 * key derived from the backup passphrase (scrypt), stored in the repository's
 * config file. The storage server only ever sees random data.
 */
export type RepoConfig = {
  format: 1;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  /** Data key wrapped with the passphrase key (iv | tag | ciphertext, base64). */
  wrappedKey: string;
  createdAt: string;
};

export type Keys = { enc: Buffer; mac: Buffer };

const KDF = { N: 2 ** 17, r: 8, p: 1 };

function deriveKey(passphrase: string, salt: Buffer, p: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(passphrase, salt, 32, { N: p.N, r: p.r, p: p.p, maxmem: 256 * p.N * p.r }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}

function open(key: Buffer, sealed: Buffer): Buffer {
  if (sealed.length < 28) throw new Error("backup data is truncated");
  const d = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  d.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
}

function splitKeys(dataKey: Buffer): Keys {
  return {
    enc: createHmac("sha256", dataKey).update("netsim-backup-enc").digest(),
    mac: createHmac("sha256", dataKey).update("netsim-backup-mac").digest(),
  };
}

export async function newRepoConfig(passphrase: string): Promise<{ config: RepoConfig; keys: Keys }> {
  const salt = randomBytes(16);
  const kek = await deriveKey(passphrase, salt, KDF);
  const dataKey = randomBytes(32);
  return {
    config: {
      format: 1,
      kdf: { name: "scrypt", ...KDF, salt: salt.toString("base64") },
      wrappedKey: seal(kek, dataKey).toString("base64"),
      createdAt: new Date().toISOString(),
    },
    keys: splitKeys(dataKey),
  };
}

export async function unlockRepo(config: RepoConfig, passphrase: string): Promise<Keys> {
  if (config.format !== 1 || config.kdf.name !== "scrypt") throw new Error("backup.unknownFormat");
  const kek = await deriveKey(passphrase, Buffer.from(config.kdf.salt, "base64"), config.kdf);
  try {
    return splitKeys(open(kek, Buffer.from(config.wrappedKey, "base64")));
  } catch {
    throw new Error("backup.wrongPassphrase");
  }
}

/** Re-wraps the same data key with a new passphrase: existing backups stay readable. */
export async function rewrapRepo(config: RepoConfig, oldPass: string, newPass: string): Promise<RepoConfig> {
  const kekOld = await deriveKey(oldPass, Buffer.from(config.kdf.salt, "base64"), config.kdf);
  let dataKey: Buffer;
  try {
    dataKey = open(kekOld, Buffer.from(config.wrappedKey, "base64"));
  } catch {
    throw new Error("backup.wrongPassphrase");
  }
  const salt = randomBytes(16);
  const kek = await deriveKey(newPass, salt, KDF);
  return { ...config, kdf: { name: "scrypt", ...KDF, salt: salt.toString("base64") }, wrappedKey: seal(kek, dataKey).toString("base64") };
}

/** Chunk id: keyed hash of the plain content, so ids reveal nothing without the key. */
export function chunkId(keys: Keys, plain: Buffer): string {
  return createHmac("sha256", keys.mac).update(plain).digest("hex");
}

export function encryptBlob(keys: Keys, plain: Buffer): Buffer {
  return seal(keys.enc, zstdCompressSync(plain));
}

export function decryptBlob(keys: Keys, sealed: Buffer): Buffer {
  return zstdDecompressSync(open(keys.enc, sealed));
}

export function verifyChunk(keys: Keys, id: string, plain: Buffer): boolean {
  const actual = Buffer.from(chunkId(keys, plain), "hex");
  const expected = Buffer.from(id, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
