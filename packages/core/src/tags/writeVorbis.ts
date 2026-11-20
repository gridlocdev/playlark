/**
 * Writing Vorbis comments (PRD §11.2), the tags of FLAC, Ogg Vorbis and Opus: the fields an edit names are taken
 * out and written again at the end; every other comment keeps its place and its bytes.
 */
import { concatBytes, decodeUtf8, u32le } from '../bytes.ts';
import { type ReadTags, type TagEdit, editedPair } from './edit.ts';
import { decodeBase64, parseFlacPicture } from './picture.ts';
import type { Picture } from './types.ts';

const utf8 = new TextEncoder();

/** A comment block as stored: the vendor string and each `NAME=value` entry's bytes. */
export interface RawComments {
  readonly vendor: Uint8Array;
  readonly entries: readonly Uint8Array[];
}

/** Splits a comment block into its parts, or null when it's cut short. Bytes after the entries are left out. */
export function splitVorbisComment(b: Uint8Array): RawComments | null {
  if (b.length < 8) return null;
  const vendorLength = u32le(b, 0);
  if (4 + vendorLength + 4 > b.length) return null;
  const vendor = b.subarray(4, 4 + vendorLength);
  let at = 4 + vendorLength;
  const count = u32le(b, at);
  at += 4;
  const entries: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 4 > b.length) return null;
    const length = u32le(b, at);
    at += 4;
    if (at + length > b.length) return null;
    entries.push(b.subarray(at, at + length));
    at += length;
  }
  return { vendor, entries };
}

function le32(n: number): Uint8Array {
  return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

export function joinVorbisComment(c: RawComments): Uint8Array {
  return concatBytes([
    le32(c.vendor.length),
    c.vendor,
    le32(c.entries.length),
    ...c.entries.flatMap((e) => [le32(e.length), e]),
  ]);
}

const be32 = (n: number) => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

/** A FLAC `PICTURE` block body for a front cover; Ogg carries the same bytes in base64. */
export function flacPictureBlock(picture: Picture): Uint8Array {
  const mime = Uint8Array.from(picture.mime, (c) => c.charCodeAt(0) & 0xff);
  return concatBytes([
    be32(3),
    be32(mime.length),
    mime,
    be32(0),
    new Uint8Array(16),
    be32(picture.data.length),
    picture.data,
  ]);
}

function base64(b: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += chars[(n >>> 18) & 63]! + chars[(n >>> 12) & 63]!;
    out += i + 1 < b.length ? chars[(n >>> 6) & 63]! : '=';
    out += i + 2 < b.length ? chars[n & 63]! : '=';
  }
  return out;
}

const nameOf = (entry: Uint8Array) => {
  const text = decodeUtf8(entry);
  const eq = text.indexOf('=');
  return eq > 0 ? text.slice(0, eq).toUpperCase() : '';
};

const PICTURE_FIELD = 'METADATA_BLOCK_PICTURE';

/** A picture's type in a `METADATA_BLOCK_PICTURE` entry, or null when it can't be read. */
function entryPictureType(entry: Uint8Array): number | null {
  const text = decodeUtf8(entry);
  const bytes = decodeBase64(text.slice(text.indexOf('=') + 1));
  return bytes ? (parseFlacPicture(bytes)?.type ?? null) : null;
}

/**
 * The comments after `edit`. `pictures` says where the cover goes: in FLAC's own `PICTURE` blocks (the caller
 * writes those), or in the comments (Ogg). `dropPicture` says which pictures the cover edit takes out.
 */
export function editVorbisComments(
  c: RawComments,
  read: ReadTags,
  edit: TagEdit,
  pictures: 'blocks' | 'comments',
  dropPicture: (type: number | null) => boolean,
): RawComments {
  const drop = new Set<string>();
  const add: string[] = [];
  const set = (names: readonly string[], value: string | null | undefined) => {
    if (value === undefined) return;
    for (const n of names) drop.add(n);
    if (value !== null) add.push(`${names[0]!}=${value}`);
  };
  set(['TITLE'], edit.title);
  set(['ARTIST'], edit.artist);
  set(['ALBUM'], edit.album);
  set(['ALBUMARTIST', 'ALBUM ARTIST', 'ALBUM_ARTIST'], edit.albumArtist);
  set(['GENRE'], edit.genre);
  for (const which of ['track', 'disc'] as const) {
    const pair = editedPair(read.tags, edit, which);
    if (!pair.changed) continue;
    const [number, short, total, otherTotal] =
      which === 'track'
        ? ['TRACKNUMBER', 'TRACK', 'TRACKTOTAL', 'TOTALTRACKS']
        : ['DISCNUMBER', 'DISC', 'DISCTOTAL', 'TOTALDISCS'];
    set([number, short], pair.n === undefined ? null : String(pair.n));
    set([total, otherTotal], pair.of === undefined ? null : String(pair.of));
  }
  if (edit.year !== undefined)
    set(['DATE', 'YEAR', 'ORIGINALDATE'], edit.year === null ? null : String(edit.year));
  if (edit.compilation !== undefined) set(['COMPILATION'], edit.compilation ? '1' : null);
  const entries = c.entries.filter((e) => {
    const name = nameOf(e);
    if (name === PICTURE_FIELD) return edit.cover === undefined || !dropPicture(entryPictureType(e));
    return !drop.has(name);
  });
  const added = add.map((t) => utf8.encode(t));
  if (pictures === 'comments' && edit.cover)
    added.unshift(utf8.encode(`${PICTURE_FIELD}=${base64(flacPictureBlock(edit.cover))}`));
  return { vendor: c.vendor, entries: [...entries, ...added] };
}

/** The picture types in a comment block's `METADATA_BLOCK_PICTURE` entries. */
export function commentPictureTypes(c: RawComments): (number | null)[] {
  return c.entries.filter((e) => nameOf(e) === PICTURE_FIELD).map(entryPictureType);
}

export const PLAYLARK_VENDOR = utf8.encode('Playlark');
