/**
 * Writing ID3 tags (PRD §11.2): an ID3v2.3 tag stays 2.3 (UTF-16 text), 2.4 stays 2.4 (UTF-8), a file without one
 * gets 2.4. Frames the edit doesn't name are kept byte for byte. An ID3v1 tag at the end is updated too.
 */
import { FormatError, concatBytes, startsWith } from '../bytes.ts';
import { type ReadTags, type TagEdit, editedPair } from './edit.ts';
import { genreName } from './genres.ts';
import { ID3V1_LENGTH } from './id3v1.ts';
import { apicType, id3v2Frames, id3v2Length, txxxName } from './id3v2.ts';
import type { Picture } from './types.ts';

/** Padding a rewritten tag gets, so the next edit fits without moving the audio. */
export const ID3_PADDING = 2048;

const utf8 = new TextEncoder();

function synchsafeBytes(n: number): number[] {
  return [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];
}

function frame(version: 3 | 4, id: string, body: Uint8Array): Uint8Array {
  const n = body.length;
  const size =
    version === 4 ? synchsafeBytes(n) : [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return concatBytes([
    Uint8Array.from(id, (c) => c.charCodeAt(0)),
    Uint8Array.from(size),
    new Uint8Array(2),
    body,
  ]);
}

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = c >>> 8;
  }
  return out;
}

/** A text frame: UTF-16 with a byte-order mark in 2.3, UTF-8 in 2.4. */
function textFrame(version: 3 | 4, id: string, text: string): Uint8Array {
  const body =
    version === 4
      ? concatBytes([Uint8Array.of(3), utf8.encode(text)])
      : concatBytes([Uint8Array.of(1, 0xff, 0xfe), utf16le(text)]);
  return frame(version, id, body);
}

function apicFrame(version: 3 | 4, picture: Picture): Uint8Array {
  const mime = Uint8Array.from(picture.mime, (c) => c.charCodeAt(0) & 0xff);
  // Latin-1, the MIME type, front cover, an empty description, then the picture.
  return frame(version, 'APIC', concatBytes([Uint8Array.of(0), mime, Uint8Array.of(0, 3, 0), picture.data]));
}

const pairText = (n: number | undefined, of: number | undefined) =>
  n === undefined && of === undefined ? null : `${n ?? 0}${of !== undefined ? `/${of}` : ''}`;

/** The frames of an ID3v2 tag after `edit`: ids it names are dropped and written again; the rest are kept. */
function editFrames(
  version: 3 | 4,
  frames: readonly { id: string; raw: Uint8Array; body: Uint8Array | null }[],
  read: ReadTags,
  edit: TagEdit,
): Uint8Array[] {
  const drop = new Set<string>();
  const dropTxxx = new Set<string>();
  const add: Uint8Array[] = [];
  const text = (id: string, value: string | null | undefined) => {
    if (value === undefined) return;
    drop.add(id);
    if (value !== null) add.push(textFrame(version, id, value));
  };
  text('TIT2', edit.title);
  text('TPE1', edit.artist);
  text('TALB', edit.album);
  text('TPE2', edit.albumArtist);
  text('TCON', edit.genre);
  const track = editedPair(read.tags, edit, 'track');
  if (track.changed) text('TRCK', pairText(track.n, track.of));
  const disc = editedPair(read.tags, edit, 'disc');
  if (disc.changed) text('TPOS', pairText(disc.n, disc.of));
  if (edit.year !== undefined) {
    for (const id of ['TDRC', 'TYER', 'TDOR', 'TORY']) drop.add(id);
    if (edit.year !== null) add.push(textFrame(version, version === 4 ? 'TDRC' : 'TYER', String(edit.year)));
  }
  if (edit.compilation !== undefined) {
    drop.add('TCMP');
    dropTxxx.add('COMPILATION');
    if (edit.compilation) add.push(textFrame(version, 'TCMP', '1'));
  }
  // The cover: the front covers go (every picture when there's none, or when the cover is removed).
  let dropPicture = (_type: number | null) => false;
  if (edit.cover !== undefined) {
    const types = frames
      .filter((f) => f.id === 'APIC')
      .map((f) => (f.body ? apicType(version, f.body) : null));
    const hasFront = types.includes(3);
    dropPicture = (type) => edit.cover === null || !hasFront || type === 3;
    if (edit.cover) add.unshift(apicFrame(version, edit.cover));
  }
  const kept = frames.filter((f) => {
    if (drop.has(f.id)) return false;
    if (f.id === 'TXXX' && f.body && dropTxxx.has(txxxName(f.body))) return false;
    if (f.id === 'APIC' && dropPicture(f.body ? apicType(version, f.body) : null)) return false;
    return true;
  });
  return [...kept.map((f) => f.raw), ...add];
}

/** An ID3v2 tag with `frames`, padded to `size` bytes of body when they fit, else with `ID3_PADDING`. */
function tagBytes(version: 3 | 4, frames: readonly Uint8Array[], size: number): Uint8Array {
  const body = concatBytes(frames);
  const length = body.length <= size ? size : body.length + ID3_PADDING;
  const out = new Uint8Array(10 + length);
  out.set([0x49, 0x44, 0x33, version, 0, 0, ...synchsafeBytes(length)]);
  out.set(body, 10);
  return out;
}

/** ID3v1 text: Latin-1 (anything else becomes "?"), cut to the field and padded with zeros. */
function v1Text(out: Uint8Array, at: number, length: number, value: string | null): void {
  out.fill(0, at, at + length);
  if (value === null) return;
  for (let i = 0; i < Math.min(length, value.length); i++) {
    const c = value.charCodeAt(i);
    out[at + i] = c < 256 ? c : 0x3f;
  }
}

function genreIndex(name: string): number {
  for (let i = 0; i < 256; i++) if (genreName(i)?.toLowerCase() === name.toLowerCase()) return i;
  return 255;
}

/** The ID3v1 tag (128 bytes starting "TAG") after `edit`. */
function editId3v1(tag: Uint8Array, edit: TagEdit): Uint8Array {
  const out = tag.slice();
  if (edit.title !== undefined) v1Text(out, 3, 30, edit.title);
  if (edit.artist !== undefined) v1Text(out, 33, 30, edit.artist);
  if (edit.album !== undefined) v1Text(out, 63, 30, edit.album);
  if (edit.year !== undefined) v1Text(out, 93, 4, edit.year === null ? null : String(edit.year));
  if (edit.track !== undefined) {
    const n = edit.track ?? 0;
    out[125] = 0;
    out[126] = n <= 255 ? n : 0;
  }
  if (edit.genre !== undefined) out[127] = edit.genre === null ? 255 : genreIndex(edit.genre);
  return out;
}

/** An MP3 file (or any file whose tags are an ID3v2 tag at `offset`) with `edit` written into its tags. */
export function writeMp3Tags(file: Uint8Array, read: ReadTags, edit: TagEdit): Uint8Array {
  const length = id3v2Length(file.subarray(0, 10));
  let tag: Uint8Array;
  let rest: Uint8Array;
  if (length === null) {
    tag = tagBytes(4, editFrames(4, [], read, edit), 0);
    rest = file;
  } else {
    const parsed = id3v2Frames(file.subarray(0, length));
    if (!parsed || parsed.version === 2) throw new FormatError('Playlark can’t edit ID3v2.2 tags.');
    const version = parsed.version;
    tag = tagBytes(version, editFrames(version, parsed.frames, read, edit), length - 10);
    rest = file.subarray(length);
  }
  const v1At = rest.length - ID3V1_LENGTH;
  if (v1At >= 0 && startsWith(rest, 'TAG', v1At))
    return concatBytes([tag, rest.subarray(0, v1At), editId3v1(rest.subarray(v1At), edit)]);
  return concatBytes([tag, rest]);
}

/** Where an MP3 file's audio is: after the ID3v2 tag, before an ID3v1 tag. */
export function mp3Audio(file: Uint8Array): Uint8Array {
  const start = id3v2Length(file.subarray(0, 10)) ?? 0;
  const end =
    file.length >= ID3V1_LENGTH && startsWith(file, 'TAG', file.length - ID3V1_LENGTH)
      ? file.length - ID3V1_LENGTH
      : file.length;
  return file.subarray(start, Math.max(start, end));
}
