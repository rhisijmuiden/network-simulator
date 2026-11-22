import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

/**
 * Encrypts stored secrets (SMTP password, backup credentials) with a 256-bit key
 * kept in the data directory, outside the database. A database dump alone does
 * not reveal the secrets; a backup carries the key inside its encrypted archive.
 */
let key: Buffer | undefined;

export function secretKeyPath(): string {
  return join(config.dataDir, "secret.key");
}

function getKey(): Buffer {
  if (key) return key;
  const path = secretKeyPath();
  if (!existsSync(path)) {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(path, randomBytes(32).toString("base64") + "\n", { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  const k = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
  if (k.length !== 32) throw new Error(`invalid secret key in ${path}`);
  key = k;
  return k;
}

/** Forgets the cached key, for example after a restore replaced the file. */
export function resetSecretKey(): void {
  key = undefined;
}

export function encryptSecret(plain: string): string {
  if (plain === "") return "";
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}

export function decryptSecret(stored: string): string {
  if (stored === "") return "";
  if (!stored.startsWith("v1:")) throw new Error("unknown secret format");
  const raw = Buffer.from(stored.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", getKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
