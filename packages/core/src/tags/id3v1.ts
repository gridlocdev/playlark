/** ID3v1 and v1.1 tags: the last 128 bytes of an MP3 (PRD §4.1). Used only for fields ID3v2 leaves out. */
import { type ByteSource, decodeLatin1, startsWith } from '../bytes.ts';
import { genreName } from './genres.ts';
import { type Tags, setText } from './types.ts';

export const ID3V1_LENGTH = 128;

/** The tag at the end of the file, or null when there isn't one. */
export async function readId3v1(source: ByteSource): Promise<Tags | null> {
  if (source.size < ID3V1_LENGTH) return null;
  const b = await source.read(source.size - ID3V1_LENGTH, ID3V1_LENGTH);
  if (!startsWith(b, 'TAG')) return null;
  return parseId3v1(b);
}

function field(b: Uint8Array, at: number, length: number): string {
  const raw = b.subarray(at, at + length);
  const end = raw.indexOf(0);
  return decodeLatin1(end < 0 ? raw : raw.subarray(0, end));
}

/** Parses the 128 bytes starting with "TAG". */
export function parseId3v1(b: Uint8Array): Tags {
  const tags: Tags = {};
  setText(tags, 'title', field(b, 3, 30));
  setText(tags, 'artist', field(b, 33, 30));
  setText(tags, 'album', field(b, 63, 30));
  const year = Number(field(b, 93, 4).trim());
  if (Number.isInteger(year) && year > 0) tags.year = year;
  // v1.1: a zero byte before the comment's last byte means that byte is the track number.
  if (b[125] === 0 && (b[126] ?? 0) > 0) tags.track = b[126];
  const genre = genreName(b[127] ?? 255);
  if (genre !== undefined) tags.genre = genre;
  return tags;
}
