/**
 * Writing playlists in the music folder (PRD §9.1, §9.3) for the desktop app, the NAS server and the CLI. Every
 * write carries the version the caller last read and happens under the playlist's lock file, so nothing written
 * elsewhere is overwritten without the user's choice. Deleting moves the file to the trash in the app's data folder
 * (§11.4). Only `.m3u8` and `.m3u` files inside the folder are ever written.
 */
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { isPlaylistPath } from '@playlark/core';
import { versionOf, writeAtomic } from './atomic.ts';
import { FolderError, type FolderErrorCode } from './errors.ts';
import { withLockFile } from './lockFile.ts';

export const TRASH_FOLDER = 'trash';
/** Trash older than this is deleted on start (§11.4). */
export const TRASH_KEEP_DAYS = 30;

/** What a playlist write gives back over IPC or HTTP: the new version, or why it was refused. */
export type PlaylistResult =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly code: FolderErrorCode | 'failed'; readonly message: string };

const isCode = (e: unknown, code: string) => (e as NodeJS.ErrnoException).code === code;

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (e) {
    if (isCode(e, 'ENOENT')) return false;
    throw e;
  }
}

/**
 * Where `rel` is (or would be) inside `root`: the folders that exist on the way must really be inside the folder,
 * links included, and so must the file a link at `rel` points at.
 */
export async function playlistTarget(root: string, rel: string): Promise<string> {
  const parts = rel.split('/');
  if (
    !isPlaylistPath(rel) ||
    rel.includes('\0') ||
    rel.includes('\\') ||
    parts.some((p) => p === '' || p === '.' || p === '..')
  )
    throw new FolderError('outside', 'That is not a playlist in the music folder.');
  const realRoot = await realpath(root);
  const inside = (p: string) => p === realRoot || p.startsWith(realRoot + path.sep);
  let at = realRoot;
  for (const [i, part] of parts.entries()) {
    const next = path.join(at, part);
    if (!(await exists(next))) return path.join(next, ...parts.slice(i + 1));
    at = await realpath(next).catch(() => next);
    if (!inside(at) || at === realRoot)
      throw new FolderError('outside', 'That is not a playlist in the music folder.');
  }
  return at;
}

async function versionOnDisk(file: string): Promise<string | null> {
  try {
    return versionOf(await readFile(file));
  } catch (e) {
    if (isCode(e, 'ENOENT')) return null;
    throw e;
  }
}

function checkBase(name: string, found: string | null, base: string | null): void {
  if (base === null && found !== null) throw new FolderError('exists', `“${name}” already exists.`);
  if (base !== null && found === null)
    throw new FolderError('deleted', `“${name}” was deleted somewhere else.`);
  if (base !== null && found !== base) throw new FolderError('changed', `“${name}” changed somewhere else.`);
}

/**
 * Writes `bytes` to the playlist at `rel` if it is still at version `base` (null: only if there is no file yet,
 * creating its folder). Gives the new version; a conflict is a FolderError `changed`, `deleted` or `exists`.
 */
export async function writePlaylistFile(
  root: string,
  rel: string,
  bytes: Uint8Array,
  base: string | null,
): Promise<string> {
  const file = await playlistTarget(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  return withLockFile(file, async () => {
    checkBase(path.basename(rel), await versionOnDisk(file), base);
    await writeAtomic(file, bytes);
    return versionOf(bytes);
  });
}

/** Renames the playlist at `from` to `to` in the same folder or another; `to` must not exist yet. */
export async function renamePlaylistFile(root: string, from: string, to: string): Promise<string> {
  const source = await playlistTarget(root, from);
  // Keep the name as typed: on a disk that ignores case, "mix.m3u8" → "Mix.m3u8" finds the same file.
  const found = await playlistTarget(root, to);
  const target = path.join(path.dirname(found), path.basename(to));
  return withLockFile(source, async () => {
    const version = await versionOnDisk(source);
    if (version === null)
      throw new FolderError('deleted', `“${path.basename(from)}” was deleted somewhere else.`);
    if (!(await sameFile(source, target)) && (await exists(target)))
      throw new FolderError('exists', `“${path.basename(to)}” already exists.`);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(source, target);
    return version;
  });
}

async function sameFile(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([stat(a).catch(() => null), stat(b).catch(() => null)]);
  return x !== null && y !== null && x.ino === y.ino && x.dev === y.dev;
}

/** `trash/<YYYY-MM-DD>/<rel>` in local time, with " 2", " 3"… before the extension when taken. */
export async function trashPath(dataDir: string, rel: string, now: Date): Promise<string> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const base = path.join(dataDir, TRASH_FOLDER, day, ...rel.split('/'));
  const ext = path.extname(base);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base.slice(0, base.length - ext.length)} ${n}${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
}

/**
 * Moves the playlist at `rel` to the trash in `dataDir` if it is still at version `base` (§9.2, §11.4). Gives the
 * version it had, so Undo can put the same bytes back.
 */
export async function trashPlaylistFile(
  root: string,
  rel: string,
  base: string,
  dataDir: string,
  now = new Date(),
): Promise<string> {
  const file = await playlistTarget(root, rel);
  return withLockFile(file, async () => {
    checkBase(path.basename(rel), await versionOnDisk(file), base);
    const to = await trashPath(dataDir, rel, now);
    await mkdir(path.dirname(to), { recursive: true });
    try {
      await rename(file, to);
    } catch (e) {
      if (!isCode(e, 'EXDEV')) throw e;
      await copyFile(file, to);
      await rm(file);
    }
    return base;
  });
}

/** Deletes the dated trash folders older than `TRASH_KEEP_DAYS` (§11.4), on start. */
export async function emptyOldTrash(dataDir: string, now = new Date()): Promise<void> {
  const trash = path.join(dataDir, TRASH_FOLDER);
  const names = await readdir(trash).catch((e: unknown) => {
    if (isCode(e, 'ENOENT')) return [];
    throw e;
  });
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - TRASH_KEEP_DAYS);
  for (const name of names) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(name);
    if (m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) < cutoff)
      await rm(path.join(trash, name), { recursive: true, force: true });
  }
}

/** Runs a playlist write and turns its outcome into a `PlaylistResult` (any other error is `failed`). */
export async function playlistResult(write: () => Promise<string>): Promise<PlaylistResult> {
  try {
    return { ok: true, version: await write() };
  } catch (e) {
    if (e instanceof FolderError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}
