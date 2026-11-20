/** The library's sort order (PRD §4.4, §5): natural, case-blind, by sort-name tags, a leading "The " ignored. */
import { baseName } from './files.ts';
import { NO_STATS, type FolderStats } from '../stats.ts';
import type { Song } from './song.ts';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The text a name sorts by: its sort-name tag when there is one, else the name without a leading "The ". */
export function sortKey(name: string, sortName?: string): string {
  return sortName?.trim() || name.replace(/^the\s+/i, '');
}

export function compareNames(a: string, b: string, aSort?: string, bSort?: string): number {
  return collator.compare(sortKey(a, aSort), sortKey(b, bSort));
}

/** Plain natural order, for file names and paths. */
export function compareText(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Disc, then track (songs without one after those with one), then file name (§4.4). */
export function compareInAlbum(a: Song, b: Song): number {
  return (
    (a.disc ?? 1) - (b.disc ?? 1) ||
    (a.track ?? Number.MAX_SAFE_INTEGER) - (b.track ?? Number.MAX_SAFE_INTEGER) ||
    collator.compare(baseName(a.path), baseName(b.path)) ||
    collator.compare(a.path, b.path)
  );
}

/** Album artist, album, then the album's own order (§6.2's default). */
export function compareSongs(a: Song, b: Song): number {
  return (
    compareNames(a.albumArtist, b.albumArtist, a.albumArtistSort, b.albumArtistSort) ||
    compareNames(a.album, b.album, a.albumSort, b.albumSort) ||
    compareInAlbum(a, b)
  );
}

export function sortSongs(songs: readonly Song[]): Song[] {
  return [...songs].sort(compareSongs);
}

/** The Songs table's columns that sort when their header is clicked (§6.2). */
export type SongColumn = 'favourite' | 'title' | 'artist' | 'album' | 'time' | 'plays';

type Compare = (a: Song, b: Song, stats: FolderStats) => number;
const of = (stats: FolderStats, s: Song) => stats.get(s.path) ?? NO_STATS;

/** ♥ and Plays put the favourites and the most played first. */
const BY_COLUMN: Record<SongColumn, Compare> = {
  favourite: (a, b, stats) => Number(of(stats, b).favourite) - Number(of(stats, a).favourite),
  title: (a, b) => compareNames(a.title, b.title, a.titleSort, b.titleSort),
  artist: (a, b) => compareNames(a.artist, b.artist, a.artistSort, b.artistSort),
  album: (a, b) => compareNames(a.album, b.album, a.albumSort, b.albumSort),
  time: (a, b) => a.duration - b.duration,
  plays: (a, b, stats) => of(stats, b).plays - of(stats, a).plays,
};

/**
 * The songs sorted by `column` (ties in the default order), reversed when `reverse`. Null: the default order.
 * `stats` is what ♥ and Plays sort by (§10).
 */
export function sortSongsBy(
  songs: readonly Song[],
  column: SongColumn | null,
  reverse = false,
  stats: FolderStats = new Map(),
): Song[] {
  const by = column ? BY_COLUMN[column] : null;
  const sorted = [...songs].sort((a, b) => (by ? by(a, b, stats) : 0) || compareSongs(a, b));
  return reverse ? sorted.reverse() : sorted;
}
