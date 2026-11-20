/**
 * Search (PRD §6.4): every word typed must start a word in some field, ignoring case and accents. The words are
 * worked out once per library, so a search only compares prefixes.
 */
import { stem } from './files.ts';
import { type Album, type Artist, type Library, fold } from './browse.ts';
import type { Song } from './song.ts';

interface Entry<T> {
  readonly item: T;
  readonly words: readonly string[];
}

export interface SearchIndex {
  readonly songs: readonly Entry<Song>[];
  readonly albums: readonly Entry<Album>[];
  readonly artists: readonly Entry<Artist>[];
}

export interface SearchResults {
  readonly artists: readonly Artist[];
  readonly albums: readonly Album[];
  readonly songs: readonly Song[];
}

/** The words in `texts`, folded, each once. */
export function wordsOf(...texts: (string | undefined)[]): string[] {
  const words = new Set<string>();
  for (const t of texts) if (t) for (const w of fold(t).split(/[^\p{L}\p{N}]+/u)) if (w) words.add(w);
  return [...words];
}

/** Title, artist, album, album artist, genre and file name (§6.4). */
export function prepareSearch(library: Library): SearchIndex {
  return {
    songs: library.songs.map((s) => ({
      item: s,
      words: wordsOf(s.title, s.artist, s.album, s.albumArtist, s.genre, stem(s.path)),
    })),
    albums: library.albums.map((a) => ({ item: a, words: wordsOf(a.title, a.artist) })),
    artists: library.artists.map((a) => ({ item: a, words: wordsOf(a.name) })),
  };
}

const matches = (words: readonly string[], query: readonly string[]) =>
  query.every((q) => words.some((w) => w.startsWith(q)));

/** Everything that matches `query`, in library order. An empty query matches nothing. */
export function search(index: SearchIndex, query: string): SearchResults {
  const q = wordsOf(query);
  if (q.length === 0) return { artists: [], albums: [], songs: [] };
  const pick = <T>(entries: readonly Entry<T>[]) =>
    entries.filter((e) => matches(e.words, q)).map((e) => e.item);
  return { artists: pick(index.artists), albums: pick(index.albums), songs: pick(index.songs) };
}
