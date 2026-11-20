/** The open folder's index between runs (PRD §3.2): read at once on open, written after each scan. */
import { coverIds, makeIndex, type Song } from '@playlark/core';
import type { IndexStore } from '@playlark/ui';

/** The songs from the index kept for `root`, or null (the index is only a cache: without it, the scan reads all). */
export async function loadIndexSongs(
  index: IndexStore | undefined,
  root: string,
): Promise<readonly Song[] | null> {
  try {
    return (await index?.load(root))?.songs ?? null;
  } catch {
    return null;
  }
}

/** Keeps the scan's songs for next time and deletes covers no song uses; gives the error message on failure. */
export async function saveIndexSongs(
  index: IndexStore | undefined,
  root: string,
  songs: readonly Song[],
  now: Date,
): Promise<string | null> {
  if (!index) return null;
  try {
    await index.save(makeIndex(root, songs, now));
    await index.pruneCovers(coverIds(songs));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
