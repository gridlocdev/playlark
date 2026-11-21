/**
 * The library as the CLI sees it: every command rescans first, reusing every file whose size and time haven't
 * changed (PRD §3.3), saves the index the desktop app reads, and keeps favourites and play counts with songs
 * that moved (§10.1).
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  type FolderStats,
  type Library,
  type Song,
  buildLibrary,
  coverIds,
  findMoves,
  isPlaylistPath,
  makeIndex,
  moveStats,
  noteAdded,
  parseIndex,
  parseStatsFile,
  scanLibrary,
  writeStatsFile,
} from '@playlark/core';
import {
  STATS_FILE,
  folderScanSource,
  indexFolder,
  readTextFile,
  withLockFile,
  writeAtomic,
} from '@playlark/node-files';
import { CliError } from './errors.ts';
import type { Where } from './folder.ts';

export interface Loaded {
  readonly songs: readonly Song[];
  readonly library: Library;
  /** Every `.m3u8` and `.m3u` in the folder, by path. */
  readonly playlists: readonly string[];
  readonly songByPath: ReadonlyMap<string, Song>;
}

/** Moves stats with moved songs and dates new ones, in the shared `stats.json`, under its lock file. */
async function updateStats(where: Where, before: readonly Song[], songs: readonly Song[], now: Date) {
  const file = path.join(where.data, STATS_FILE);
  const moves = findMoves(before, songs);
  await mkdir(where.data, { recursive: true });
  await withLockFile(file, async () => {
    const { text } = await readTextFile(file);
    const all = text === null ? new Map<string, FolderStats>() : parseStatsFile(text);
    if (!all) throw new CliError(`${file} can’t be read, so favourites and play counts were left alone.`);
    const stats: FolderStats = all.get(where.name) ?? new Map();
    const after = noteAdded(moveStats(stats, moves), songs, now.getTime(), stats.size === 0);
    if (after === stats) return;
    all.set(where.name, after);
    await writeAtomic(file, writeStatsFile(all));
  });
}

export async function loadLibrary(where: Where, now = new Date()): Promise<Loaded> {
  const store = indexFolder(where.indexDir);
  const saved = await store.load();
  const previous = saved === null ? null : parseIndex(saved, where.name);
  const source = folderScanSource(where.folder);
  let playlists: string[] = [];
  const songs = await scanLibrary(
    {
      list: async () => {
        const files = await source.list();
        playlists = files.filter((f) => isPlaylistPath(f.path)).map((f) => f.path);
        return files;
      },
      open: (f) => source.open(f),
    },
    {
      ...(previous ? { previous: previous.songs } : {}),
      onCover: (id, picture) => store.saveCover(id, picture.mime, picture.data),
    },
  );
  if (!previous || JSON.stringify(previous.songs) !== JSON.stringify(songs)) {
    await store.save(JSON.stringify(makeIndex(where.name, songs, now)));
    await store.pruneCovers(coverIds(songs));
  }
  await updateStats(where, previous?.songs ?? [], songs, now);
  return {
    songs,
    library: buildLibrary(songs),
    playlists,
    songByPath: new Map(songs.map((s) => [s.path, s])),
  };
}
