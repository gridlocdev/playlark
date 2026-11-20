/**
 * Reading binary files a range at a time (PRD §4). A `ByteSource` is a file on disk, in the browser, on the NAS or
 * in memory; the tag readers only ever ask it for byte ranges.
 */

export interface ByteSource {
  /** The file's length in bytes. */
  readonly size: number;
  /** Up to `length` bytes from `offset`; fewer at the end of the file, none past it. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** A source over bytes already in memory (tests, and a tag found inside another container). */
export function memorySource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read: (offset, length) => {
      const start = Math.max(0, Math.min(offset, bytes.length));
      return Promise.resolve(bytes.subarray(start, Math.min(bytes.length, start + Math.max(0, length))));
    },
  };
}

/** Reads exactly `length` bytes or fails with a message naming what was being read. */
export async function readExactly(
  source: ByteSource,
  offset: number,
  length: number,
  what: string,
): Promise<Uint8Array> {
  const bytes = await source.read(offset, length);
  if (bytes.length < length) throw new FormatError(`The file ends inside its ${what}.`);
  return bytes;
}

/** A file that isn't laid out the way its format says: the message is shown to the user as is. */
export class FormatError extends Error {
  override readonly name = 'FormatError';
}

export function u16be(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
}

export function u16le(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
}

export function u24be(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) << 16) | ((b[at + 1] ?? 0) << 8) | (b[at + 2] ?? 0);
}

export function u32be(b: Uint8Array, at: number): number {
  return (
    ((b[at] ?? 0) * 0x1000000 + (((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0))) >>> 0
  );
}

export function u32le(b: Uint8Array, at: number): number {
  return (
    ((b[at + 3] ?? 0) * 0x1000000 + (((b[at + 2] ?? 0) << 16) | ((b[at + 1] ?? 0) << 8) | (b[at] ?? 0))) >>> 0
  );
}

/** A 64-bit big-endian number; exact up to 2^53, which every real file size and sample count is. */
export function u64be(b: Uint8Array, at: number): number {
  return u32be(b, at) * 0x100000000 + u32be(b, at + 4);
}

/** A 64-bit little-endian signed number (an Ogg granule position); -1 stays -1. */
export function i64le(b: Uint8Array, at: number): number {
  const low = u32le(b, at);
  const high = u32le(b, at + 4);
  if (high === 0xffffffff && low === 0xffffffff) return -1;
  return high * 0x100000000 + low;
}

/** ID3v2's 28-bit "synchsafe" number: four bytes of seven bits each. */
export function synchsafe(b: Uint8Array, at: number): number {
  return (
    (((b[at] ?? 0) & 0x7f) << 21) |
    (((b[at + 1] ?? 0) & 0x7f) << 14) |
    (((b[at + 2] ?? 0) & 0x7f) << 7) |
    ((b[at + 3] ?? 0) & 0x7f)
  );
}

/** Four bytes as Latin-1 text: a chunk, atom or frame id. MP4's © (0xA9) stays ©. */
export function fourCC(b: Uint8Array, at: number, length = 4): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(b[at + i] ?? 0);
  return s;
}

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const utf16le = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');

export function decodeLatin1(b: Uint8Array): string {
  return latin1.decode(b);
}

export function decodeUtf8(b: Uint8Array): string {
  return utf8.decode(b);
}

/** UTF-16 with or without a byte-order mark; without one, little-endian (what most taggers write). */
export function decodeUtf16(b: Uint8Array, bigEndianByDefault = false): string {
  if (b[0] === 0xfe && b[1] === 0xff) return utf16be.decode(b.subarray(2));
  if (b[0] === 0xff && b[1] === 0xfe) return utf16le.decode(b.subarray(2));
  return (bigEndianByDefault ? utf16be : utf16le).decode(b);
}

/** True when `b` starts with the ASCII text `magic` at `at`. */
export function startsWith(b: Uint8Array, magic: string, at = 0): boolean {
  if (b.length < at + magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (b[at + i] !== magic.charCodeAt(i)) return false;
  return true;
}

/** Joins byte arrays into one. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
