/**
 * Favourites and play counts (PRD §10): kept per song path in `stats.json` in the app's data folder, never in the
 * music files. Unlike the index this is the user's data: a file that can't be read is never written over.
 */
import type { Song } from './library/song.ts';

export const STATS_FORMAT = 1;

export interface SongStats {
  readonly favourite: boolean;
  readonly plays: number;
  /** When it last counted as played, in ms since 1970, or null. */
  readonly lastPlayed: number | null;
  /** When it first entered the index, in ms since 1970 (§6.2 Recently Added), or null until then. */
  readonly added: number | null;
}

/** One folder's stats, by song path. */
export type FolderStats = ReadonlyMap<string, SongStats>;

export const NO_STATS: SongStats = { favourite: false, plays: 0, lastPlayed: null, added: null };

/** A play counts after half the song or this many seconds, whichever comes first (§10.2). */
export const COUNT_AFTER = 240;
/** Recently Added holds the songs added in this many days (§6.2). */
export const RECENT_DAYS = 90;
/** Most Played holds this many songs (§6.2). */
export const MOST_PLAYED = 100;

const isTime = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isFinite(v));

function songStats(v: unknown): SongStats | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const plays = o['plays'] ?? 0;
  const lastPlayed = o['lastPlayed'] ?? null;
  const added = o['added'] ?? null;
  if (typeof plays !== 'number' || !Number.isInteger(plays) || plays < 0) return null;
  if (!isTime(lastPlayed) || !isTime(added)) return null;
  return { favourite: o['favourite'] === true, plays, lastPlayed, added };
}

/**
 * Every folder's stats in a `stats.json`, by the folder's root (its path, or its name in the browser). Null when
 * the text isn't a stats file this version reads: the caller must then leave the file alone.
 */
export function parseStatsFile(text: string): Map<string, FolderStats> | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const folders = o['folders'];
  if (o['format'] !== STATS_FORMAT || typeof folders !== 'object' || folders === null) return null;
  const out = new Map<string, FolderStats>();
  for (const [root, songs] of Object.entries(folders)) {
    if (typeof songs !== 'object' || songs === null) return null;
    const map = new Map<string, SongStats>();
    for (const [path, s] of Object.entries(songs)) {
      const stats = songStats(s);
      if (!stats) return null;
      map.set(path, stats);
    }
    out.set(root, map);
  }
  return out;
}

/** The text of a `stats.json` holding `folders`. Songs with nothing to keep are left out. */
export function writeStatsFile(folders: ReadonlyMap<string, FolderStats>): string {
  const out: Record<string, Record<string, Partial<SongStats>>> = {};
  for (const [root, songs] of folders) {
    const kept: Record<string, Partial<SongStats>> = {};
    for (const [path, s] of songs) {
      const entry: { -readonly [K in keyof SongStats]?: SongStats[K] } = {};
      if (s.favourite) entry.favourite = true;
      if (s.plays > 0) entry.plays = s.plays;
      if (s.lastPlayed !== null) entry.lastPlayed = s.lastPlayed;
      if (s.added !== null) entry.added = s.added;
      if (Object.keys(entry).length > 0) kept[path] = entry;
    }
    out[root] = kept;
  }
  return JSON.stringify({ format: STATS_FORMAT, folders: out });
}

/** How long a song must play before it counts (§10.2); never for a song of unknown length. */
export function countAfter(duration: number): number {
  return duration > 0 ? Math.min(duration / 2, COUNT_AFTER) : Infinity;
}

/**
 * How long the song started `play`th has been heard. The player is sampled while it runs; only the time between
 * two samples that both found it playing counts, so a seek adds nothing and a pause stops the clock.
 */
export interface Listening {
  readonly play: number;
  readonly at: number;
  readonly playing: boolean;
  /** Seconds heard. */
  readonly heard: number;
  readonly counted: boolean;
}

/**
 * Takes one sample: `play` names the start (a new number each time a song starts), `now` is a clock in ms.
 * `count` is true once per start, when the song has been heard long enough (§10.2).
 */
export function listen(
  before: Listening | null,
  sample: {
    readonly play: number;
    readonly playing: boolean;
    readonly now: number;
    readonly duration: number;
  },
): { readonly listening: Listening; readonly count: boolean } {
  const { play, playing, now, duration } = sample;
  if (!before || before.play !== play)
    return { listening: { play, at: now, playing, heard: 0, counted: false }, count: false };
  const heard = before.heard + (before.playing && playing ? Math.max(0, now - before.at) / 1000 : 0);
  const count = !before.counted && heard >= countAfter(duration);
  return { listening: { play, at: now, playing, heard, counted: before.counted || count }, count };
}

/** `stats` with each song moved (from → to) keeping its own; a song already at the new path keeps its own. */
export function moveStats(stats: FolderStats, moves: ReadonlyMap<string, string>): FolderStats {
  if (moves.size === 0) return stats;
  const out = new Map(stats);
  for (const [from, to] of moves) {
    const s = stats.get(from);
    if (!s) continue;
    out.delete(from);
    if (!out.has(to)) out.set(to, s);
  }
  return out;
}

/**
 * Notes when each song with no `added` time entered the index (§6.2): now, or on the folder's first scan the
 * file's modified time. Gives `stats` itself when nothing changed.
 */
export function noteAdded(
  stats: FolderStats,
  songs: readonly Song[],
  now: number,
  firstScan: boolean,
): FolderStats {
  let out: Map<string, SongStats> | null = null;
  for (const song of songs) {
    const s = stats.get(song.path) ?? NO_STATS;
    if (s.added !== null) continue;
    out ??= new Map(stats);
    out.set(song.path, { ...s, added: firstScan ? song.mtime : now });
  }
  return out ?? stats;
}

const statsOf = (stats: FolderStats, song: Song) => stats.get(song.path) ?? NO_STATS;

/** Favourites (§6.2), in the order of `songs`. */
export function favourites(songs: readonly Song[], stats: FolderStats): Song[] {
  return songs.filter((s) => statsOf(stats, s).favourite);
}

/** Recently Added (§6.2): songs added in the last 90 days, newest first; until noted, by the file's time. */
export function recentlyAdded(songs: readonly Song[], stats: FolderStats, now: number): Song[] {
  const since = now - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const added = (s: Song) => statsOf(stats, s).added ?? s.mtime;
  return songs.filter((s) => !s.error && added(s) >= since).sort((a, b) => added(b) - added(a));
}

/** Most Played (§6.2): the top 100 by play count, ties by the one played last. */
export function mostPlayed(songs: readonly Song[], stats: FolderStats): Song[] {
  const of = (s: Song) => statsOf(stats, s);
  return songs
    .filter((s) => of(s).plays > 0)
    .sort((a, b) => of(b).plays - of(a).plays || (of(b).lastPlayed ?? 0) - (of(a).lastPlayed ?? 0))
    .slice(0, MOST_PLAYED);
}
