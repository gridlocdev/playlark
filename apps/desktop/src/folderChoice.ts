/**
 * Which music folder the desktop app plays (PRD §16.2), remembered in `folder.json` in its data folder. No
 * Electron imports, so tests run it.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FolderInfo } from './bridge.ts';

/** The folder the app last used, or null. */
export async function loadFolderChoice(file: string): Promise<string | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    // Never chosen, or a damaged file: the page asks again.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return null;
    throw e;
  }
  const folder = (raw as { folder?: unknown } | null)?.folder;
  return typeof folder === 'string' && path.isAbsolute(folder) ? folder : null;
}

export async function saveFolderChoice(file: string, folder: string): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(temp, `${JSON.stringify({ folder })}\n`, 'utf8');
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

/** True when `folder` is there and is a folder (a drive may be unplugged). */
export async function folderExists(folder: string): Promise<boolean> {
  try {
    return (await stat(folder)).isDirectory();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

export async function folderInfo(folder: string): Promise<FolderInfo> {
  return { path: folder, name: path.basename(folder) || folder, missing: !(await folderExists(folder)) };
}

/**
 * The music folder at start: PLAYLARK_MUSIC when set (checks point it at fixtures), else the one
 * remembered, else none.
 */
export async function startFolder(env: NodeJS.ProcessEnv, choiceFile: string): Promise<string | null> {
  const fromEnv = env.PLAYLARK_MUSIC;
  if (fromEnv) return path.resolve(fromEnv);
  return loadFolderChoice(choiceFile);
}
