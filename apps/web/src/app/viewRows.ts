/** The songs each view lists, in their shown order (PRD §6.2): what Play, the keys and Select All work on. */
import {
  favourites,
  fold,
  mostPlayed,
  recentlyAdded,
  sortSongsBy,
  type FolderStats,
  type Library,
  type SearchResults,
  type Song,
  type SongColumn,
} from '@playlark/core';
import type { View } from './views.ts';

/** The Songs table's order: a column, or null for the default (§6.2). */
export interface SongOrder {
  readonly column: SongColumn | null;
  readonly reverse: boolean;
}

export interface RowSources {
  readonly library: Library;
  readonly order: SongOrder;
  readonly results: () => SearchResults | null;
  readonly playlist: (path: string) => readonly Song[];
  readonly stats: () => FolderStats;
  /** Now, in ms since 1970 (Recently Added). */
  readonly now: () => number;
}

export function viewRows(view: View, from: RowSources): readonly Song[] {
  const lib = from.library;
  switch (view.kind) {
    case 'songs': {
      const { column, reverse } = from.order;
      if (column === null && !reverse) return lib.songs;
      const byStats = column === 'favourite' || column === 'plays';
      return sortSongsBy(lib.songs, column, reverse, byStats ? from.stats() : undefined);
    }
    case 'album':
      return lib.albumByKey.get(view.key)?.songs ?? [];
    case 'artist': {
      const artist = lib.artistByKey.get(view.key);
      if (!artist) return [];
      const theirs = (songs: readonly Song[]) => songs.filter((s) => fold(s.artist) === artist.key);
      return [...artist.albums.flatMap((a) => a.songs), ...artist.appearsOn.flatMap((a) => theirs(a.songs))];
    }
    case 'folders':
      return lib.folderByPath.get(view.path)?.songs ?? [];
    case 'search':
      return from.results()?.songs ?? [];
    case 'playlist':
      return from.playlist(view.path);
    case 'favourites':
      return favourites(lib.songs, from.stats());
    case 'recent':
      return recentlyAdded(lib.songs, from.stats(), from.now());
    case 'mostPlayed':
      return mostPlayed(lib.songs, from.stats());
    case 'albums':
    case 'artists':
      return [];
  }
}
