/** `scan`, `songs`, `albums`, `artists`, `search` and `check` (PRD §20): reading the library, never writing it. */
import {
  type Album,
  type Song,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
  buildLibrary,
  fold,
  prepareSearch,
  search,
  stem,
  wordsOf,
} from '@playlark/core';
import type { Filter } from './args.ts';
import { CliError } from './errors.ts';
import type { Loaded } from './library.ts';

/** What a command prints: lines for people, an object for `--json`. */
export interface Output {
  readonly lines: readonly string[];
  readonly json: Readonly<Record<string, unknown>>;
}

export function time(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A song as `--json` gives it. */
export function songJson(s: Song): Record<string, unknown> {
  return {
    path: s.path,
    title: s.title,
    artist: s.artist,
    album: s.album,
    albumArtist: s.albumArtist,
    ...(s.track !== undefined ? { track: s.track } : {}),
    ...(s.disc !== undefined ? { disc: s.disc } : {}),
    ...(s.year !== undefined ? { year: s.year } : {}),
    ...(s.genre !== undefined ? { genre: s.genre } : {}),
    duration: s.duration,
    format: s.format,
    ...(s.error !== undefined ? { error: s.error } : {}),
  };
}

export function songLine(s: Song): string {
  if (s.error) return `${s.path}  (can’t read: ${s.error})`;
  return `${s.artist} — ${s.album} — ${s.title} (${time(s.duration)})  ${s.path}`;
}

function albumJson(a: Album): Record<string, unknown> {
  return {
    title: a.title,
    artist: a.artist,
    ...(a.year !== undefined ? { year: a.year } : {}),
    songs: a.songs.length,
    duration: a.duration,
    cover: a.cover !== undefined,
  };
}

const albumLine = (a: Album) =>
  `${a.artist} — ${a.title}${a.year !== undefined ? ` (${a.year})` : ''}, ${a.songs.length} song${a.songs.length === 1 ? '' : 's'}, ${time(a.duration)}`;

/** Every word of `query` starts a word of one of `fields` (§6.4). */
function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const words = wordsOf(...fields);
  return wordsOf(query).every((q) => words.some((w) => w.startsWith(q)));
}

export function filterSongs(songs: readonly Song[], filters: Partial<Record<Filter, string>>): Song[] {
  let year: number | undefined;
  if (filters.year !== undefined) {
    year = Number(filters.year);
    if (!Number.isInteger(year)) throw new CliError(`--year ${filters.year} is not a year.`);
  }
  return songs.filter(
    (s) =>
      (filters.artist === undefined || matches(filters.artist, s.artist, s.albumArtist)) &&
      (filters.album === undefined || matches(filters.album, s.album)) &&
      (filters.genre === undefined || matches(filters.genre, s.genre)) &&
      (year === undefined || s.year === year),
  );
}

export function scanReport(loaded: Loaded): Output {
  const { library } = loaded;
  const unreadable = library.songs.filter((s) => s.error).length;
  const counts = {
    songs: library.songs.length,
    albums: library.albums.length,
    artists: library.artists.length,
    unreadable,
  };
  return {
    lines: [
      `${counts.songs} songs, ${counts.albums} albums, ${counts.artists} artists, ${unreadable} unreadable`,
    ],
    json: counts,
  };
}

export function songsReport(loaded: Loaded, filters: Partial<Record<Filter, string>>): Output {
  const songs = filterSongs(loaded.library.songs, filters);
  return { lines: songs.map(songLine), json: { songs: songs.map(songJson) } };
}

export function albumsReport(loaded: Loaded, filters: Partial<Record<Filter, string>>): Output {
  const { albums } = buildLibrary(filterSongs(loaded.library.songs, filters));
  return { lines: albums.map(albumLine), json: { albums: albums.map(albumJson) } };
}

export function artistsReport(loaded: Loaded, filters: Partial<Record<Filter, string>>): Output {
  const { artists } = buildLibrary(filterSongs(loaded.library.songs, filters));
  return {
    lines: artists.map((a) => `${a.name} (${a.albums.length} album${a.albums.length === 1 ? '' : 's'})`),
    json: { artists: artists.map((a) => ({ name: a.name, albums: a.albums.length })) },
  };
}

export function searchReport(loaded: Loaded, words: string): Output {
  if (wordsOf(words).length === 0) throw new CliError('search needs words to look for.');
  const found = search(prepareSearch(loaded.library), words);
  const lines = [
    ...(found.artists.length ? ['Artists', ...found.artists.map((a) => `  ${a.name}`)] : []),
    ...(found.albums.length ? ['Albums', ...found.albums.map((a) => `  ${albumLine(a)}`)] : []),
    ...(found.songs.length ? ['Songs', ...found.songs.map((s) => `  ${songLine(s)}`)] : []),
  ];
  return {
    lines: lines.length ? lines : [`Nothing matches “${words}”.`],
    json: {
      artists: found.artists.map((a) => ({ name: a.name, albums: a.albums.length })),
      albums: found.albums.map(albumJson),
      songs: found.songs.map(songJson),
    },
  };
}

/** The tags a readable song is missing: a title (it shows its file name), artist, album or track number. */
export function missingTags(s: Song): string[] {
  if (s.error) return [];
  return [
    ...(s.title === stem(s.path) ? ['title'] : []),
    ...(s.artist === UNKNOWN_ARTIST ? ['artist'] : []),
    ...(s.album === UNKNOWN_ALBUM ? ['album'] : []),
    ...(s.track === undefined ? ['track number'] : []),
  ];
}

/** Songs with the same artist and title, durations within 2 s: each group shortest first. */
export function likelyDuplicates(songs: readonly Song[]): Song[][] {
  const byName = new Map<string, Song[]>();
  for (const s of songs) {
    if (s.error) continue;
    const key = `${fold(s.artist)}\u0000${fold(s.title)}`;
    byName.set(key, [...(byName.get(key) ?? []), s]);
  }
  const groups: Song[][] = [];
  for (const same of byName.values()) {
    const sorted = [...same].sort((a, b) => a.duration - b.duration);
    let group: Song[] = [];
    for (const s of sorted) {
      const last = group.at(-1);
      if (last && s.duration - last.duration > 2) {
        if (group.length > 1) groups.push(group);
        group = [];
      }
      group.push(s);
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

export function checkReport(loaded: Loaded): Output {
  const { library } = loaded;
  const missing = library.songs
    .map((s) => ({ song: s, missing: missingTags(s) }))
    .filter((m) => m.missing.length);
  const noCover = library.albums.filter((a) => a.cover === undefined);
  const duplicates = likelyDuplicates(library.songs);
  const unreadable = library.songs.filter((s) => s.error);
  const lines = [
    ...(missing.length
      ? ['Missing tags', ...missing.map((m) => `  ${m.song.path}: no ${m.missing.join(', ')}`)]
      : []),
    ...(noCover.length ? ['Albums without cover art', ...noCover.map((a) => `  ${albumLine(a)}`)] : []),
    ...(duplicates.length
      ? [
          'Likely duplicates',
          ...duplicates.flatMap((g) => g.map((s, i) => `${i ? '    ' : '  - '}${songLine(s)}`)),
        ]
      : []),
    ...(unreadable.length ? ['Unreadable files', ...unreadable.map((s) => `  ${s.path}: ${s.error}`)] : []),
  ];
  return {
    lines: lines.length ? lines : ['Nothing to fix.'],
    json: {
      missingTags: missing.map((m) => ({ path: m.song.path, missing: m.missing })),
      albumsWithoutCover: noCover.map(albumJson),
      likelyDuplicates: duplicates.map((g) => g.map((s) => s.path)),
      unreadable: unreadable.map((s) => ({ path: s.path, error: s.error })),
    },
  };
}
