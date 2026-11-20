/** The library's sort order (PRD §5): natural, case-blind, a leading "The " ignored. */
import type { Song } from './song.ts';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The text a name sorts by: "The Beatles" sorts as "Beatles". */
export function sortKey(name: string): string {
  return name.replace(/^the\s+/i, '');
}

export function compareNames(a: string, b: string): number {
  return collator.compare(sortKey(a), sortKey(b));
}

/** Album artist, album, disc, track, then title and path so the order is always the same. */
export function compareSongs(a: Song, b: Song): number {
  return (
    compareNames(a.albumArtist, b.albumArtist) ||
    compareNames(a.album, b.album) ||
    (a.disc ?? 1) - (b.disc ?? 1) ||
    (a.track ?? Number.MAX_SAFE_INTEGER) - (b.track ?? Number.MAX_SAFE_INTEGER) ||
    compareNames(a.title, b.title) ||
    collator.compare(a.path, b.path)
  );
}

export function sortSongs(songs: readonly Song[]): Song[] {
  return [...songs].sort(compareSongs);
}
