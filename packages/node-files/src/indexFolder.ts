/**
 * The library index and its covers in an app data folder (PRD §3.2): `library.json` and `covers/<sha256>.<ext>`.
 * Shared by the desktop app (Electron's userData) and the NAS server (its data folder). Never the music folder.
 */
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { keepAddedTimes, parseStatsFile, writeStatsFile } from '@playlark/core';
import { writeAtomic } from './atomic.ts';
import { withLockFile } from './lockFile.ts';

export const INDEX_FILE = 'library.json';
export const QUEUE_FILE = 'queue.json';
/** Favourites and play counts (PRD §10.1). */
export const STATS_FILE = 'stats.json';
export const COVERS_FOLDER = 'covers';

const COVER_ID = /^[0-9a-f]{64}$/;
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MIME_BY_EXTENSION = new Map(Object.entries(EXTENSIONS).map(([mime, ext]) => [ext, mime]));

export interface StoredCover {
  readonly file: string;
  readonly mime: string;
}

export interface IndexFolder {
  /** The saved index's text, or null when there is none yet. */
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
  /** Stores a cover once; a cover already there is left alone. */
  saveCover(id: string, mime: string, data: Uint8Array): Promise<void>;
  /** The stored file for a cover id, or null. */
  cover(id: string): Promise<StoredCover | null>;
  /** Deletes every stored cover not in `keep`. */
  pruneCovers(keep: ReadonlySet<string>): Promise<void>;
  /** The play queue kept between runs (PRD §8.4), or null. */
  loadQueue(): Promise<string | null>;
  saveQueue(text: string): Promise<void>;
  /** Favourites and play counts (PRD §10.1), or null when there are none yet. */
  loadStats(): Promise<string | null>;
  saveStats(text: string): Promise<void>;
}

function isMissing(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === 'ENOENT';
}

export function indexFolder(dir: string): IndexFolder {
  const covers = path.join(dir, COVERS_FOLDER);
  const storedCovers = async (): Promise<string[]> => {
    try {
      return await readdir(covers);
    } catch (e) {
      if (isMissing(e)) return [];
      throw e;
    }
  };
  const readText = async (name: string): Promise<string | null> => {
    try {
      return await readFile(path.join(dir, name), 'utf8');
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  };
  return {
    load: () => readText(INDEX_FILE),
    save: (text) => writeAtomic(path.join(dir, INDEX_FILE), text),
    loadQueue: () => readText(QUEUE_FILE),
    saveQueue: (text) => writeAtomic(path.join(dir, QUEUE_FILE), text),
    loadStats: () => readText(STATS_FILE),
    saveStats: (text) => {
      const file = path.join(dir, STATS_FILE);
      // Under the same lock file as the CLI, keeping the `added` times it wrote since this text was read.
      return withLockFile(file, async () => {
        const mine = parseStatsFile(text);
        if (!mine) throw new Error('That is not a stats file Playlark reads.');
        const before = await readText(STATS_FILE);
        const onDisk = before === null ? new Map() : parseStatsFile(before);
        if (!onDisk) throw new Error(`${file} can’t be read, so favourites and play counts were left alone.`);
        await writeAtomic(file, writeStatsFile(keepAddedTimes(mine, onDisk)));
      });
    },
    saveCover: async (id, mime, data) => {
      const ext = EXTENSIONS[mime];
      if (!COVER_ID.test(id) || !ext) throw new Error('That is not a cover Playlark stores.');
      const file = path.join(covers, `${id}.${ext}`);
      if ((await storedCovers()).includes(`${id}.${ext}`)) return;
      await writeAtomic(file, data);
    },
    cover: async (id) => {
      if (!COVER_ID.test(id)) return null;
      const name = (await storedCovers()).find((n) => n.startsWith(`${id}.`));
      const mime = name ? MIME_BY_EXTENSION.get(name.slice(id.length + 1)) : undefined;
      return name && mime ? { file: path.join(covers, name), mime } : null;
    },
    pruneCovers: async (keep) => {
      for (const name of await storedCovers()) {
        const id = name.slice(0, name.indexOf('.'));
        if (COVER_ID.test(id) && !keep.has(id)) await rm(path.join(covers, name), { force: true });
      }
    },
  };
}
