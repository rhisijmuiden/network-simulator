import { Client as FtpClient, type FTPResponse } from "basic-ftp";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import type { TLSSocket } from "node:tls";
import { Client as SshClient, type SFTPWrapper } from "ssh2";

export type LocationType = "ftp" | "ftps" | "scp";

export type LocationOptions = {
  /** FTPS: implicit TLS (port 990) instead of explicit AUTH TLS. */
  implicitTls?: boolean;
  /** FTPS: verify the certificate against the system CAs. */
  verifyCertificate?: boolean;
  /** FTPS: pinned SHA-256 fingerprint of a self-signed certificate. */
  tlsFingerprint?: string;
  /** SCP/SFTP: pinned SHA-256 host key fingerprint (base64, like ssh-keygen -l). */
  hostKeyFingerprint?: string;
  /** SCP/SFTP: authenticate with a private key instead of a password. */
  authType?: "password" | "key";
};

export type LocationConfig = {
  type: LocationType;
  host: string;
  port: number;
  username: string;
  /** Password, or the private key in OpenSSH/PEM format. */
  secret: string;
  passphrase?: string;
  path: string;
  options: LocationOptions;
};

/** Minimal file storage used by the backup repository. Paths are relative to the location's folder. */
export interface Backend {
  put(path: string, data: Buffer): Promise<void>;
  get(path: string): Promise<Buffer>;
  list(dir: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  removeDir(dir: string): Promise<void>;
  close(): Promise<void>;
  /** Fingerprint presented by the server (SSH host key or TLS certificate). */
  fingerprint(): string;
}

export class FingerprintError extends Error {
  constructor(readonly fingerprint: string, readonly changed: boolean) {
    super(changed ? "backup.fingerprintChanged" : "backup.fingerprintUnknown");
  }
}

export async function openBackend(cfg: LocationConfig): Promise<Backend> {
  if (cfg.type === "scp") return SftpBackend.connect(cfg);
  return FtpBackend.connect(cfg);
}

const join = (root: string, p: string) => posix.join(root || ".", p);

class FtpBackend implements Backend {
  private dirs = new Set<string>();
  private constructor(private client: FtpClient, private root: string, private fp: string) {}

  static async connect(cfg: LocationConfig): Promise<FtpBackend> {
    const client = new FtpClient(30_000);
    const secure = cfg.type === "ftps" ? (cfg.options.implicitTls ? "implicit" : true) : false;
    const pinned = cfg.options.tlsFingerprint;
    const verify = cfg.options.verifyCertificate !== false && !pinned;
    await client.access({
      host: cfg.host,
      port: cfg.port,
      user: cfg.username || "anonymous",
      password: cfg.secret,
      secure,
      secureOptions: secure ? { rejectUnauthorized: verify, servername: cfg.host, minVersion: "TLSv1.2" } : undefined,
    });
    let fp = "";
    if (secure) {
      const cert = (client.ftp.socket as TLSSocket).getPeerCertificate?.();
      fp = cert?.fingerprint256 ?? "";
      if (!verify && pinned !== fp) {
        client.close();
        throw new FingerprintError(fp, Boolean(pinned));
      }
    }
    const root = cfg.path.startsWith("/") ? cfg.path : posix.join(await client.pwd(), cfg.path);
    return new FtpBackend(client, root, fp);
  }

  private async ensureDir(dir: string): Promise<void> {
    if (this.dirs.has(dir)) return;
    await this.client.ensureDir(dir);
    await this.client.cd("/");
    this.dirs.add(dir);
  }

  async put(path: string, data: Buffer): Promise<void> {
    const full = join(this.root, path);
    await this.ensureDir(posix.dirname(full));
    const tmp = full + ".part";
    await this.client.uploadFrom(Readable.from([data]), tmp);
    await this.client.rename(tmp, full);
  }

  async get(path: string): Promise<Buffer> {
    const parts: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        parts.push(chunk);
        cb();
      },
    });
    await this.client.downloadTo(sink, join(this.root, path));
    return Buffer.concat(parts);
  }

  async list(dir: string): Promise<string[]> {
    try {
      const entries = await this.client.list(join(this.root, dir));
      return entries.map((e) => e.name).filter((n) => n !== "." && n !== "..");
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  async remove(path: string): Promise<void> {
    await this.client.remove(join(this.root, path), true);
  }

  async removeDir(dir: string): Promise<void> {
    await this.client.removeDir(join(this.root, dir));
    this.dirs.clear();
  }

  async close(): Promise<void> {
    this.client.close();
  }

  fingerprint(): string {
    return this.fp;
  }
}

function isNotFound(err: unknown): boolean {
  const code = (err as FTPResponse & { code?: number })?.code;
  return code === 550 || code === 450;
}

class SftpBackend implements Backend {
  private dirs = new Set<string>();
  private constructor(private conn: SshClient, private sftp: SFTPWrapper, private root: string, private fp: string) {}

  static connect(cfg: LocationConfig): Promise<SftpBackend> {
    return new Promise((resolve, reject) => {
      const conn = new SshClient();
      let fp = "";
      let fpError: FingerprintError | null = null;
      conn.on("error", (err) => reject(fpError ?? err));
      conn.on("ready", () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          sftp.realpath(cfg.path || ".", (e, abs) => {
            resolve(new SftpBackend(conn, sftp, e ? cfg.path || "." : abs, fp));
          });
        });
      });
      const useKey = cfg.options.authType === "key";
      conn.connect({
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        password: useKey ? undefined : cfg.secret,
        privateKey: useKey ? cfg.secret : undefined,
        passphrase: useKey ? cfg.passphrase : undefined,
        readyTimeout: 20_000,
        algorithms: {
          // Modern algorithms only.
          kex: ["curve25519-sha256", "curve25519-sha256@libssh.org", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "diffie-hellman-group16-sha512", "diffie-hellman-group14-sha256"],
          cipher: ["chacha20-poly1305@openssh.com", "aes256-gcm@openssh.com", "aes128-gcm@openssh.com", "aes256-ctr", "aes128-ctr"],
        },
        hostVerifier: (key: Buffer) => {
          fp = "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
          const pinned = cfg.options.hostKeyFingerprint;
          if (pinned === fp) return true;
          fpError = new FingerprintError(fp, Boolean(pinned));
          return false;
        },
      });
    });
  }

  private call<T>(fn: (cb: (err: Error | null | undefined, v?: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v as T))));
  }

  private async ensureDir(dir: string): Promise<void> {
    if (this.dirs.has(dir) || dir === "/" || dir === ".") return;
    await this.ensureDir(posix.dirname(dir));
    try {
      await this.call((cb) => this.sftp.mkdir(dir, cb));
    } catch {
      // exists already, or the next write reports the real problem
    }
    this.dirs.add(dir);
  }

  async put(path: string, data: Buffer): Promise<void> {
    const full = join(this.root, path);
    await this.ensureDir(posix.dirname(full));
    const tmp = full + ".part";
    await new Promise<void>((resolve, reject) => {
      const ws = this.sftp.createWriteStream(tmp);
      ws.on("error", reject);
      ws.on("close", () => resolve());
      const src = new PassThrough();
      src.pipe(ws);
      src.end(data);
    });
    await this.call((cb) => this.sftp.unlink(full, () => cb(null)));
    await this.call((cb) => this.sftp.rename(tmp, full, cb));
  }

  get(path: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parts: Buffer[] = [];
      const rs = this.sftp.createReadStream(join(this.root, path));
      rs.on("data", (c: Buffer) => parts.push(c));
      rs.on("error", reject);
      rs.on("end", () => resolve(Buffer.concat(parts)));
    });
  }

  async list(dir: string): Promise<string[]> {
    try {
      const entries = await this.call<{ filename: string }[]>((cb) => this.sftp.readdir(join(this.root, dir), cb));
      return entries.map((e) => e.filename);
    } catch {
      return [];
    }
  }

  async remove(path: string): Promise<void> {
    await this.call((cb) => this.sftp.unlink(join(this.root, path), cb));
  }

  async removeDir(dir: string): Promise<void> {
    const full = join(this.root, dir);
    const entries = await this.call<{ filename: string; attrs: { isDirectory(): boolean } }[]>((cb) => this.sftp.readdir(full, cb)).catch(() => []);
    for (const e of entries) {
      const child = posix.join(dir, e.filename);
      if (e.attrs.isDirectory()) await this.removeDir(child);
      else await this.remove(child);
    }
    await this.call((cb) => this.sftp.rmdir(full, cb)).catch(() => {});
    this.dirs.clear();
  }

  async close(): Promise<void> {
    this.conn.end();
  }

  fingerprint(): string {
    return this.fp;
  }
}
