/**
 * One library index per music folder (PRD §16.2): `libraries/<key>/` in the app's data folder holds that folder's
 * `library.json`, covers, queue and stats. The desktop app and the CLI find the same one for the same folder.
 * Only the most recently used few are kept.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, realpath, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';

export const LIBRARIES_FOLDER = 'libraries';
/** How many folders keep their index (PRD §16.2). */
export const LIBRARIES_KEPT = 3;

/** The folder's real path, so a link and its target share one index. A folder that's gone keeps its own path. */
async function realFolder(folder: string): Promise<string> {
  try {
    return await realpath(folder);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return path.resolve(folder);
    throw e;
  }
}

/** Where `folder`'s index is kept under `data`. */
export async function libraryDir(data: string, folder: string): Promise<string> {
  const key = createHash('sha256')
    .update(await realFolder(folder))
    .digest('hex')
    .slice(0, 16);
  return path.join(data, LIBRARIES_FOLDER, key);
}

/**
 * Marks `folder`'s index as used now and deletes the indexes of all but the `kept` folders used last. The
 * folders in `keep` (the one the desktop app remembers) are never deleted.
 */
export async function useLibrary(
  data: string,
  folder: string,
  keep: readonly string[] = [],
  now = new Date(),
  kept = LIBRARIES_KEPT,
): Promise<string> {
  const dir = await libraryDir(data, folder);
  await mkdir(dir, { recursive: true });
  await utimes(dir, now, now);
  const protectedDirs = new Set([dir, ...(await Promise.all(keep.map((f) => libraryDir(data, f))))]);
  const parent = path.join(data, LIBRARIES_FOLDER);
  const entries = await readdir(parent, { withFileTypes: true });
  const dated = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const full = path.join(parent, e.name);
        return { full, used: (await stat(full)).mtimeMs };
      }),
  );
  dated.sort((a, b) => b.used - a.used);
  // The protected ones count towards the few kept.
  const others = dated.filter((d) => !protectedDirs.has(d.full));
  const old = others.slice(Math.max(0, kept - protectedDirs.size));
  await Promise.all(old.map((d) => rm(d.full, { recursive: true, force: true })));
  return dir;
}
