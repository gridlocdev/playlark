/** Albums, artists and folders, made from the songs (PRD §4.4, §6.2). */
import { baseName, folderOf } from './files.ts';
import { type CoverRef, type Song } from './song.ts';
import { compareInAlbum, compareNames, compareText, sortSongs } from './sort.ts';

/** Case, accents and surrounding space taken out, for telling names apart (§4.4, §6.4). */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export interface Album {
  /** The album artist and title, folded: two spellings that differ only in case or accents are one album. */
  readonly key: string;
  readonly title: string;
  readonly artist: string;
  readonly year?: number;
  /** In disc, track, file-name order. */
  readonly songs: readonly Song[];
  readonly cover?: CoverRef;
  readonly duration: number;
  /** How many discs the songs are on. */
  readonly discs: number;
}

export interface Artist {
  /** The name, folded. */
  readonly key: string;
  readonly name: string;
  /** Their own albums, newest first (§6.2). */
  readonly albums: readonly Album[];
  /** Other album artists' albums with a song by them (§4.4). */
  readonly appearsOn: readonly Album[];
}

export interface Folder {
  /** Relative to the music folder; "" is the music folder itself. */
  readonly path: string;
  readonly name: string;
  readonly folders: readonly Folder[];
  /** The songs right in this folder, in file-name order. */
  readonly songs: readonly Song[];
}

export interface Library {
  /** Every song, in the default order (§6.2). */
  readonly songs: readonly Song[];
  readonly albums: readonly Album[];
  readonly artists: readonly Artist[];
  readonly albumByKey: ReadonlyMap<string, Album>;
  readonly artistByKey: ReadonlyMap<string, Artist>;
  /** The album each song is on, by path. */
  readonly albumOf: ReadonlyMap<string, Album>;
  readonly root: Folder;
  readonly folderByPath: ReadonlyMap<string, Folder>;
}

export const albumKey = (artist: string, title: string) => `${fold(artist)}\u0000${fold(title)}`;

/** The most common year among the songs; the latest of equally common ones. */
function commonYear(songs: readonly Song[]): number | undefined {
  const counts = new Map<number, number>();
  for (const s of songs) if (s.year !== undefined) counts.set(s.year, (counts.get(s.year) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  for (const [year, n] of counts)
    if (n > bestCount || (n === bestCount && best !== undefined && year > best)) {
      best = year;
      bestCount = n;
    }
  return best;
}

function makeAlbum(key: string, songs: Song[]): Album {
  songs.sort(compareInAlbum);
  const first = songs[0]!;
  const year = commonYear(songs);
  return {
    key,
    title: first.album,
    artist: first.albumArtist,
    ...(year !== undefined ? { year } : {}),
    songs,
    ...(first.cover ? { cover: first.cover } : {}),
    duration: songs.reduce((t, s) => t + s.duration, 0),
    discs: new Set(songs.map((s) => s.disc ?? 1)).size,
  };
}

/** Album artist, then year, then title (§6.2). */
export function compareAlbums(a: Album, b: Album): number {
  const sa = a.songs[0]!;
  const sb = b.songs[0]!;
  return (
    compareNames(a.artist, b.artist, sa.albumArtistSort, sb.albumArtistSort) ||
    (a.year ?? 0) - (b.year ?? 0) ||
    compareNames(a.title, b.title, sa.albumSort, sb.albumSort) ||
    compareText(a.key, b.key)
  );
}

/** Newest first, then by title. */
const byYearNewest = (a: Album, b: Album) =>
  (b.year ?? 0) - (a.year ?? 0) || compareNames(a.title, b.title) || compareText(a.key, b.key);

function buildFolders(songs: readonly Song[]): { root: Folder; byPath: Map<string, Folder> } {
  interface Draft {
    path: string;
    folders: Map<string, Draft>;
    songs: Song[];
  }
  const top: Draft = { path: '', folders: new Map(), songs: [] };
  for (const song of songs) {
    let at = top;
    const parts = folderOf(song.path).split('/').filter(Boolean);
    for (const part of parts) {
      let next = at.folders.get(part);
      if (!next) {
        next = { path: at.path ? `${at.path}/${part}` : part, folders: new Map(), songs: [] };
        at.folders.set(part, next);
      }
      at = next;
    }
    at.songs.push(song);
  }
  const byPath = new Map<string, Folder>();
  const finish = (d: Draft, name: string): Folder => {
    const folder: Folder = {
      path: d.path,
      name,
      folders: [...d.folders]
        .sort(([a], [b]) => compareText(a, b))
        .map(([childName, child]) => finish(child, childName)),
      songs: [...d.songs].sort((a, b) => compareText(baseName(a.path), baseName(b.path))),
    };
    byPath.set(folder.path, folder);
    return folder;
  };
  return { root: finish(top, ''), byPath };
}

/** Every song under `folder`, its own first, then each subfolder's in order (§6.2 Folders: Play). */
export function songsUnder(folder: Folder): Song[] {
  return [...folder.songs, ...folder.folders.flatMap(songsUnder)];
}

/** The library's albums, artists and folders. Unreadable songs are left out of albums and artists. */
export function buildLibrary(songs: readonly Song[]): Library {
  const sorted = sortSongs(songs);
  const drafts = new Map<string, Song[]>();
  for (const s of sorted) {
    if (s.error) continue;
    const key = albumKey(s.albumArtist, s.album);
    const list = drafts.get(key);
    if (list) list.push(s);
    else drafts.set(key, [s]);
  }
  const albums = [...drafts].map(([key, list]) => makeAlbum(key, list)).sort(compareAlbums);
  const albumByKey = new Map(albums.map((a) => [a.key, a]));
  const albumOf = new Map<string, Album>();
  for (const a of albums) for (const s of a.songs) albumOf.set(s.path, a);

  const own = new Map<string, { name: string; sort?: string; albums: Album[] }>();
  for (const a of albums) {
    const key = fold(a.artist);
    const entry = own.get(key);
    if (entry) entry.albums.push(a);
    else {
      const sort = a.songs[0]!.albumArtistSort;
      own.set(key, { name: a.artist, ...(sort ? { sort } : {}), albums: [a] });
    }
  }
  const appears = new Map<string, Set<Album>>();
  for (const a of albums)
    for (const s of a.songs) {
      const key = fold(s.artist);
      if (key === fold(a.artist) || !own.has(key)) continue;
      const set = appears.get(key) ?? new Set();
      set.add(a);
      appears.set(key, set);
    }
  const artists = [...own]
    .sort(([, a], [, b]) => compareNames(a.name, b.name, a.sort, b.sort))
    .map(([key, a]): Artist => ({
      key,
      name: a.name,
      albums: [...a.albums].sort(byYearNewest),
      appearsOn: [...(appears.get(key) ?? [])].sort(byYearNewest),
    }));
  const { root, byPath } = buildFolders(songs);
  return {
    songs: sorted,
    albums,
    artists,
    albumByKey,
    artistByKey: new Map(artists.map((a) => [a.key, a])),
    albumOf,
    root,
    folderByPath: byPath,
  };
}
