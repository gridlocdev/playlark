/** ID3v2.2, 2.3 and 2.4 tags (PRD §4.1): in MP3 files, and in WAV files' `id3 ` chunk. */
import {
  type ByteSource,
  decodeLatin1,
  decodeUtf16,
  decodeUtf8,
  fourCC,
  startsWith,
  synchsafe,
  u24be,
  u32be,
} from '../bytes.ts';
import { id3Genre } from './genres.ts';
import { pictureMime } from './picture.ts';
import { type Picture, type Tags, parseFlag, parseYear, replayGainFrom, setPair, setText } from './types.ts';

const HEADER = 10;
/** ID3v2.2's three-letter frame ids, as their 2.3/2.4 names. */
const V22_IDS: Readonly<Record<string, string>> = {
  TT2: 'TIT2',
  TP1: 'TPE1',
  TP2: 'TPE2',
  TAL: 'TALB',
  TRK: 'TRCK',
  TPA: 'TPOS',
  TYE: 'TYER',
  TCO: 'TCON',
  TCP: 'TCMP',
  TXX: 'TXXX',
  TS2: 'TSO2',
  TSA: 'TSOA',
  TSP: 'TSOP',
  TST: 'TSOT',
};

/** A parsed ID3v2 tag: its version and its text frames' values (several values joined with ", "). */
export interface Id3v2 {
  readonly version: 2 | 3 | 4;
  /** Text frames by id (`TIT2`); `TXXX` frames by `TXXX:<DESCRIPTION>` in upper case. */
  readonly text: ReadonlyMap<string, string>;
  /** `APIC` (and 2.2's `PIC`) frames, in tag order. */
  readonly pictures: readonly Picture[];
}

/** The whole tag's length (header, frames, padding and footer) from its first 10 bytes, or null if none. */
export function id3v2Length(header: Uint8Array): number | null {
  if (!startsWith(header, 'ID3') || header.length < HEADER) return null;
  const major = header[3] ?? 0;
  if (major < 2 || major > 4) return null;
  const footer = major === 4 && ((header[5] ?? 0) & 0x10) !== 0 ? HEADER : 0;
  return HEADER + synchsafe(header, 6) + footer;
}

/** Reads the ID3v2 tag at `offset`, or null when there isn't one. */
export async function readId3v2At(source: ByteSource, offset: number): Promise<Uint8Array | null> {
  const header = await source.read(offset, HEADER);
  const length = id3v2Length(header);
  if (length === null) return null;
  return source.read(offset, length);
}

/** Undoes unsynchronisation: every 0xFF 0x00 becomes 0xFF. */
function resync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    const byte = b[i]!;
    out[n++] = byte;
    if (byte === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}

/** One text value of a frame, by the frame's encoding byte. */
function decodeText(encoding: number, b: Uint8Array): string {
  switch (encoding) {
    case 0:
      return decodeLatin1(b);
    case 1:
      return decodeUtf16(b);
    case 2:
      return decodeUtf16(b, true);
    default:
      return decodeUtf8(b);
  }
}

/** Splits a frame's text at its terminators: one zero byte, or two on an even offset for UTF-16. */
function splitText(encoding: number, b: Uint8Array): Uint8Array[] {
  const wide = encoding === 1 || encoding === 2;
  const parts: Uint8Array[] = [];
  let start = 0;
  if (wide) {
    for (let i = 0; i + 1 < b.length; i += 2)
      if (b[i] === 0 && b[i + 1] === 0) {
        parts.push(b.subarray(start, i));
        start = i + 2;
      }
  } else {
    for (let i = 0; i < b.length; i++)
      if (b[i] === 0) {
        parts.push(b.subarray(start, i));
        start = i + 1;
      }
  }
  parts.push(b.subarray(start));
  return parts;
}

/** The values of a text frame's body, empty ones dropped. */
function textValues(body: Uint8Array): string[] {
  const encoding = body[0] ?? 0;
  const parts = splitText(encoding, body.subarray(1));
  // UTF-16 values after the first may carry their own byte-order mark; without one they follow the first's.
  let bigEndian = encoding === 2;
  const values: string[] = [];
  for (const p of parts) {
    if (encoding === 1 && p[0] === 0xfe && p[1] === 0xff) bigEndian = true;
    if (encoding === 1 && p[0] === 0xff && p[1] === 0xfe) bigEndian = false;
    const v = encoding === 1 ? decodeUtf16(p, bigEndian) : decodeText(encoding, p);
    if (v.trim()) values.push(v.trim());
  }
  return values;
}

/** Where an encoded string that ends with a terminator stops: the index of the terminator, or -1. */
function terminator(encoding: number, b: Uint8Array, from: number): number {
  if (encoding === 1 || encoding === 2) {
    for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return -1;
  }
  return b.indexOf(0, from);
}

/** An `APIC` frame body (or `PIC` in 2.2, with a three-letter format in place of the MIME type). */
function parsePicture(frame: Uint8Array, v22: boolean): Picture | null {
  const encoding = frame[0] ?? 0;
  let at = 1;
  let declared: string;
  if (v22) {
    declared = decodeLatin1(frame.subarray(1, 4));
    at = 4;
  } else {
    const end = frame.indexOf(0, at);
    if (end < 0) return null;
    declared = decodeLatin1(frame.subarray(at, end));
    at = end + 1;
  }
  const type = frame[at] ?? 0;
  at += 1;
  const end = terminator(encoding, frame, at);
  if (end < 0) return null;
  at = end + (encoding === 1 || encoding === 2 ? 2 : 1);
  const data = frame.slice(at);
  if (data.length === 0) return null;
  return { mime: pictureMime(data, declared), type, data };
}

/** True when `id` looks like a frame id: four (or three) upper-case letters and digits. */
function isFrameId(id: string): boolean {
  return /^[A-Z0-9]{3,4}$/.test(id);
}

/**
 * The frame size in an ID3v2.4 tag. iTunes once wrote plain 32-bit sizes there: when the synchsafe reading
 * doesn't land on another frame (or the padding) but the plain one does, the plain one is right.
 */
function v24FrameSize(b: Uint8Array, at: number, end: number): number {
  const safe = synchsafe(b, at + 4);
  const plain = u32be(b, at + 4);
  if (safe === plain) return safe;
  const landsWell = (size: number) => {
    const next = at + HEADER + size;
    if (next === end) return true;
    if (next > end) return false;
    return b[next] === 0 || isFrameId(fourCC(b, next));
  };
  return landsWell(safe) || !landsWell(plain) ? safe : plain;
}

/** Parses a whole tag (header included). Frames it can't read are skipped. */
export function parseId3v2(tag: Uint8Array): Id3v2 | null {
  if (id3v2Length(tag) === null) return null;
  const version = tag[3] as 2 | 3 | 4;
  const flags = tag[5] ?? 0;
  const declared = synchsafe(tag, 6);
  let body = tag.subarray(HEADER, Math.min(tag.length, HEADER + declared));
  // In 2.2 and 2.3 unsynchronisation covers the whole tag; in 2.4 each frame says so itself.
  if (version < 4 && (flags & 0x80) !== 0) body = resync(body);
  let at = 0;
  if ((flags & 0x40) !== 0 && version >= 3) {
    // The extended header: 2.3's size leaves out its own 4 bytes, 2.4's counts them.
    at = version === 3 ? 4 + u32be(body, 0) : synchsafe(body, 0);
  }
  const text = new Map<string, string>();
  const pictures: Picture[] = [];
  const idLength = version === 2 ? 3 : 4;
  const headerLength = version === 2 ? 6 : HEADER;
  while (at + headerLength <= body.length) {
    if (body[at] === 0) break; // padding
    const rawId = fourCC(body, at, idLength);
    if (!isFrameId(rawId)) break;
    let size: number;
    let frameFlags = 0;
    if (version === 2) size = u24be(body, at + 3);
    else if (version === 3) {
      size = u32be(body, at + 4);
      frameFlags = ((body[at + 8] ?? 0) << 8) | (body[at + 9] ?? 0);
    } else {
      size = v24FrameSize(body, at, body.length);
      frameFlags = ((body[at + 8] ?? 0) << 8) | (body[at + 9] ?? 0);
    }
    const start = at + headerLength;
    at = start + size;
    if (size <= 0 || at > body.length) break;
    const id = version === 2 ? (V22_IDS[rawId] ?? rawId) : rawId;
    let frame = body.subarray(start, start + size);
    if (version === 3) {
      // Compressed or encrypted frames can't be read without zlib or a key; skip them.
      if ((frameFlags & 0x00c0) !== 0) continue;
      if ((frameFlags & 0x0020) !== 0) frame = frame.subarray(1);
    } else if (version === 4) {
      if ((frameFlags & 0x000c) !== 0) continue;
      if ((frameFlags & 0x0040) !== 0) frame = frame.subarray(1);
      if ((frameFlags & 0x0001) !== 0) frame = frame.subarray(4);
      if ((frameFlags & 0x0002) !== 0) frame = resync(frame);
    }
    if (id === 'APIC' || rawId === 'PIC') {
      const picture = parsePicture(frame, version === 2);
      if (picture) pictures.push(picture);
    } else if (id === 'TXXX') {
      const [description, ...values] = textValues(frame);
      if (description !== undefined && values.length > 0)
        text.set(`TXXX:${description.toUpperCase()}`, values.join(', '));
    } else if (id.startsWith('T')) {
      const values = textValues(frame);
      if (values.length > 0 && !text.has(id)) text.set(id, values.join(', '));
    }
  }
  return { version, text, pictures };
}

/** The fields Playlark uses, from a parsed tag. */
export function id3v2Tags(tag: Id3v2): Tags {
  const t = tag.text;
  const tags: Tags = {};
  setText(tags, 'title', t.get('TIT2'));
  setText(tags, 'artist', t.get('TPE1'));
  setText(tags, 'album', t.get('TALB'));
  setText(tags, 'albumArtist', t.get('TPE2'));
  setPair(tags, 'track', t.get('TRCK'));
  setPair(tags, 'disc', t.get('TPOS'));
  const year = parseYear(t.get('TDRC') ?? t.get('TYER') ?? t.get('TDOR') ?? t.get('TORY'));
  if (year !== undefined) tags.year = year;
  const genre = t.get('TCON');
  if (genre) setText(tags, 'genre', genre.split(', ').map(id3Genre).join(', '));
  const compilation = parseFlag(t.get('TCMP') ?? t.get('TXXX:COMPILATION'));
  if (compilation !== undefined) tags.compilation = compilation;
  setText(tags, 'artistSort', t.get('TSOP'));
  setText(tags, 'albumArtistSort', t.get('TSO2') ?? t.get('TXXX:ALBUMARTISTSORT'));
  setText(tags, 'albumSort', t.get('TSOA'));
  setText(tags, 'titleSort', t.get('TSOT'));
  const replayGain = replayGainFrom((key) => t.get(`TXXX:REPLAYGAIN_${key}`));
  if (replayGain) tags.replayGain = replayGain;
  return tags;
}
