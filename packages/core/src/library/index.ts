/** The library index (PRD §3.2): a cache of the last scan, kept outside the music folder and thrown away when in doubt. */
import type { Song } from './song.ts';

export const INDEX_FORMAT = 1;

export interface LibraryIndex {
  readonly format: typeof INDEX_FORMAT;
  /** The folder's absolute path, or its name where there is no path (the browser). */
  readonly root: string;
  /** ISO 8601. */
  readonly scannedAt: string;
  readonly songs: readonly Song[];
}

export function makeIndex(root: string, songs: readonly Song[], scannedAt: Date): LibraryIndex {
  return { format: INDEX_FORMAT, root, scannedAt: scannedAt.toISOString(), songs };
}

function isSong(v: unknown): v is Song {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s['path'] === 'string' &&
    typeof s['size'] === 'number' &&
    typeof s['mtime'] === 'number' &&
    typeof s['title'] === 'string' &&
    typeof s['artist'] === 'string' &&
    typeof s['album'] === 'string' &&
    typeof s['albumArtist'] === 'string' &&
    typeof s['duration'] === 'number' &&
    typeof s['codec'] === 'string'
  );
}

/**
 * The index in `text` when it is for `root` and in a format this version reads; null otherwise, and the caller
 * scans from nothing (§3.2: a missing, corrupt or newer index is rebuilt with no question asked).
 */
export function parseIndex(text: string, root: string): LibraryIndex | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o['format'] !== INDEX_FORMAT || o['root'] !== root || typeof o['scannedAt'] !== 'string') return null;
  const songs = o['songs'];
  if (!Array.isArray(songs) || !songs.every(isSong)) return null;
  return { format: INDEX_FORMAT, root, scannedAt: o['scannedAt'], songs };
}

/** The embedded covers the songs use, by id: every other stored cover can go (§3.2). */
export function coverIds(songs: readonly Song[]): Set<string> {
  const ids = new Set<string>();
  for (const s of songs) if (s.cover?.kind === 'embedded') ids.add(s.cover.id);
  return ids;
}

/**
 * Songs whose file moved (§3.3): gone at one path, new at another, with the same size, title, artist, album and
 * duration. Old path to new path, one to one; a match that could go two ways is left out.
 */
export function findMoves(before: readonly Song[], after: readonly Song[]): Map<string, string> {
  const afterPaths = new Set(after.map((s) => s.path));
  const beforePaths = new Set(before.map((s) => s.path));
  const key = (s: Song) => JSON.stringify([s.size, s.title, s.artist, s.album, s.duration]);
  const added = new Map<string, string[]>();
  for (const s of after) {
    if (beforePaths.has(s.path) || s.error) continue;
    const list = added.get(key(s)) ?? [];
    list.push(s.path);
    added.set(key(s), list);
  }
  const gone = new Map<string, string[]>();
  for (const s of before) {
    if (afterPaths.has(s.path) || s.error) continue;
    const list = gone.get(key(s)) ?? [];
    list.push(s.path);
    gone.set(key(s), list);
  }
  const moves = new Map<string, string>();
  for (const [k, from] of gone) {
    const to = added.get(k);
    if (from.length === 1 && to?.length === 1) moves.set(from[0]!, to[0]!);
  }
  return moves;
}
