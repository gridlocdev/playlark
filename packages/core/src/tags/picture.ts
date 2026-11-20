/** Embedded pictures (PRD §4.6): FLAC `PICTURE` blocks, Ogg `METADATA_BLOCK_PICTURE` and the MIME type fix-up. */
import { decodeLatin1, startsWith, u32be } from '../bytes.ts';
import type { Picture } from './types.ts';

/** The MIME type the bytes show, else what the tag says, lower-cased ("image/jpg" becomes "image/jpeg"). */
export function pictureMime(data: Uint8Array, declared: string): string {
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (startsWith(data, '\x89PNG')) return 'image/png';
  if (startsWith(data, 'GIF8')) return 'image/gif';
  if (startsWith(data, 'RIFF') && startsWith(data, 'WEBP', 8)) return 'image/webp';
  const m = declared.trim().toLowerCase();
  if (m === 'jpg' || m === 'image/jpg') return 'image/jpeg';
  if (m === 'png') return 'image/png';
  return m.includes('/') ? m : 'application/octet-stream';
}

/** A FLAC `PICTURE` block body (also what Ogg's `METADATA_BLOCK_PICTURE` holds), or null when it's cut short. */
export function parseFlacPicture(b: Uint8Array): Picture | null {
  let at = 0;
  const need = (n: number) => at + n <= b.length;
  if (!need(8)) return null;
  const type = u32be(b, at);
  const mimeLength = u32be(b, at + 4);
  at += 8;
  if (!need(mimeLength + 4)) return null;
  const mime = decodeLatin1(b.subarray(at, at + mimeLength));
  at += mimeLength;
  const descriptionLength = u32be(b, at);
  at += 4;
  if (!need(descriptionLength + 20)) return null;
  // Description, then width, height, depth, colours (16 bytes), then the data length.
  at += descriptionLength + 16;
  const length = u32be(b, at);
  at += 4;
  if (!need(length) || length === 0) return null;
  const data = b.slice(at, at + length);
  return { mime: pictureMime(data, mime), type, data };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUE = new Map(Array.from(BASE64, (c, i) => [c, i]));

/** Decodes base64, ignoring whitespace and padding; null when another character turns up. */
export function decodeBase64(text: string): Uint8Array | null {
  const clean = text.replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let n = 0;
  for (const c of clean) {
    const v = BASE64_VALUE.get(c);
    if (v === undefined) return null;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (value >>> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}
