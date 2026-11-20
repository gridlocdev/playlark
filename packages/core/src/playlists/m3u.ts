/**
 * Playlist files (PRD §9.1): `.m3u8` and `.m3u`, read the way other players write them and written back the way
 * other players read them. Pure: bytes in, bytes out.
 */
import { folderOf, stem } from '../library/files.ts';
import type { Song } from '../library/song.ts';

export type PlaylistEncoding = 'utf-8' | 'windows-1252';

export interface PlaylistEntry {
  /** The path as the file has it. */
  readonly raw: string;
  /** The song it names, as a path in the music folder; null when it points outside the folder. */
  readonly path: string | null;
  /** `#` lines (not `#EXTM3U` or `#EXTINF`) that came before it; written back before it. */
  readonly comments: readonly string[];
  /** Its `#EXTINF` line, kept for an entry whose song isn't in the library. */
  readonly extinf?: string;
}

export interface PlaylistFile {
  readonly entries: readonly PlaylistEntry[];
  /** `#` lines after the last entry. */
  readonly trailing: readonly string[];
  readonly encoding: PlaylistEncoding;
}

export const EMPTY_PLAYLIST: PlaylistFile = { entries: [], trailing: [], encoding: 'utf-8' };

/** A playlist's name: its file name without the extension. */
export const playlistName = (path: string): string => stem(path);

const isM3u = (path: string) => /\.m3u$/i.test(path);

/** Windows-1252's characters at 0x80–0x9F; the rest of 0xA0–0xFF are the same as Unicode. */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';

/** Decoded by hand: Node's decoders read 0x80–0x9F as control characters even when asked for Windows-1252. */
function decode1252(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  return s;
}

function decode(bytes: Uint8Array, path: string): { text: string; encoding: PlaylistEncoding } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // Not UTF-8: an old `.m3u` is Windows-1252; a `.m3u8` is UTF-8 regardless.
    if (isM3u(path)) return { text: decode1252(bytes), encoding: 'windows-1252' };
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
  }
}

/** Joins `rel` onto `folder`, resolving `.` and `..`; null when it climbs out of the music folder. */
function join(folder: string, rel: string): string | null {
  const out = folder === '' ? [] : folder.split('/');
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.length > 0 ? out.join('/') : null;
}

function percentDecoded(s: string): string {
  if (!/%[0-9a-f]{2}/i.test(s)) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const isAbsolute = (p: string) => p.startsWith('/') || /^[a-z]:\//i.test(p);

/**
 * The music-folder path an entry names. `root` is the folder's absolute path, when known, for entries written
 * with absolute paths; `exists` picks between the path as written and its percent-decoded form.
 */
export function resolveEntry(
  raw: string,
  playlistPath: string,
  root?: string,
  exists?: (path: string) => boolean,
): string | null {
  let p = raw.trim();
  const url = /^file:\/\//i.test(p);
  if (url) p = percentDecoded(p.replace(/^file:\/\/(localhost)?/i, ''));
  p = p.replace(/\\/g, '/');
  if (url && /^\/[a-z]:\//i.test(p)) p = p.slice(1);
  const at = (q: string): string | null => {
    if (!isAbsolute(q)) return join(folderOf(playlistPath), q);
    if (root === undefined) return null;
    const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
    const windows = /^[a-z]:\//i.test(r);
    const head = q.slice(0, r.length + 1);
    const inside = windows ? head.toLowerCase() === `${r}/`.toLowerCase() : head === `${r}/`;
    return inside ? join('', q.slice(r.length + 1)) : null;
  };
  const plain = at(p);
  if (url) return plain;
  const decoded = at(percentDecoded(p));
  if (plain !== null && (exists?.(plain) ?? decoded === plain)) return plain;
  if (decoded !== null && exists?.(decoded)) return decoded;
  return plain ?? decoded;
}

/** Reads a playlist file (PRD §9.1). Never throws: whatever isn't an entry or a kept comment is dropped. */
export function parsePlaylist(
  bytes: Uint8Array,
  playlistPath: string,
  root?: string,
  exists?: (path: string) => boolean,
): PlaylistFile {
  const { text, encoding } = decode(bytes, playlistPath);
  const entries: PlaylistEntry[] = [];
  let comments: string[] = [];
  let extinf: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (l === '' || /^#EXTM3U\b/i.test(l)) continue;
    if (/^#EXTINF:/i.test(l)) extinf = l;
    else if (l.startsWith('#')) comments.push(l);
    else {
      const path = resolveEntry(l, playlistPath, root, exists);
      entries.push({ raw: l, path, comments, ...(extinf !== undefined ? { extinf } : {}) });
      comments = [];
      extinf = undefined;
    }
  }
  return { entries, trailing: comments, encoding };
}

/** The path of `to` relative to the folder `from`, with `/` between names. */
export function relativePath(from: string, to: string): string {
  const a = from === '' ? [] : from.split('/');
  const b = to.split('/');
  let same = 0;
  while (same < a.length && same < b.length - 1 && a[same] === b[same]) same++;
  return [...a.slice(same).map(() => '..'), ...b.slice(same)].join('/');
}

/** A new entry for a song in the library, written relative to the playlist. */
export function entryFor(playlistPath: string, path: string): PlaylistEntry {
  return { raw: relativePath(folderOf(playlistPath), path), path, comments: [] };
}

function encode1252(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const high = CP1252_HIGH.indexOf(ch);
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else if (high >= 0) out.push(0x80 + high);
    else out.push(0x3f); // "?": the character has no Windows-1252 byte.
  }
  return Uint8Array.from(out);
}

/**
 * Writes a playlist (PRD §9.1): `#EXTM3U`, then each entry's kept comments, its `#EXTINF` and its path relative to
 * the playlist, LF line endings, no BOM, in the encoding it was read in.
 */
export function writePlaylist(
  file: PlaylistFile,
  playlistPath: string,
  songOf: (path: string) => Song | undefined,
): Uint8Array {
  const lines = ['#EXTM3U'];
  for (const e of file.entries) {
    lines.push(...e.comments);
    const song = e.path === null ? undefined : songOf(e.path);
    if (song && !song.error)
      lines.push(`#EXTINF:${Math.round(song.duration)},${song.artist} - ${song.title}`);
    else if (e.extinf !== undefined) lines.push(e.extinf);
    lines.push(e.path === null ? e.raw : relativePath(folderOf(playlistPath), e.path));
  }
  lines.push(...file.trailing);
  const text = `${lines.join('\n')}\n`;
  return file.encoding === 'windows-1252' ? encode1252(text) : new TextEncoder().encode(text);
}
