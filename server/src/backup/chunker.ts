import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

/**
 * Content-defined chunking (Gear hash, FastCDC style). Cut points depend on the
 * content, so inserting bytes early in a file only changes the chunks around
 * the insertion. That makes incremental backups small.
 */
export const MIN_CHUNK = 256 * 1024;
export const AVG_CHUNK = 1024 * 1024;
export const MAX_CHUNK = 4 * 1024 * 1024;
const MASK = AVG_CHUNK - 1; // 2^20 - 1: a cut on average every 1 MiB after MIN_CHUNK

const GEAR = (() => {
  // Deterministic table: the chunk boundaries must be identical on every server.
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    t[i] = createHash("sha256").update(`netsim-gear-${i}`).digest().readUInt32LE(0);
  }
  return t;
})();

/** Returns the length of the next chunk in buf (buf may be shorter than MAX_CHUNK at the end of input). */
export function cutPoint(buf: Buffer, final: boolean): number {
  const n = buf.length;
  if (n <= MIN_CHUNK) return final ? n : -1;
  const limit = Math.min(n, MAX_CHUNK);
  let h = 0;
  for (let i = MIN_CHUNK; i < limit; i++) {
    h = ((h << 1) + GEAR[buf[i]!]!) >>> 0;
    if ((h & MASK) === 0) return i + 1;
  }
  if (limit === MAX_CHUNK) return MAX_CHUNK;
  return final ? n : -1;
}

export async function* chunkStream(input: Readable): AsyncGenerator<Buffer> {
  let pending: Buffer = Buffer.alloc(0);
  for await (const piece of input) {
    pending = pending.length ? Buffer.concat([pending, piece as Buffer]) : (piece as Buffer);
    for (;;) {
      const cut = cutPoint(pending, false);
      if (cut < 0) break;
      yield pending.subarray(0, cut);
      pending = pending.subarray(cut);
    }
  }
  while (pending.length) {
    const cut = cutPoint(pending, true);
    yield pending.subarray(0, cut);
    pending = pending.subarray(cut);
  }
}
