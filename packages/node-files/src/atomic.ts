/**
 * Reading and writing files on disk for the desktop app, the NAS server and the CLI (PRD §3.4). Saves are
 * atomic: a temp file, flushed, renamed over the target, then the folder flushed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';

/** What a read found: the text and its version, or nulls when there is no file. */
export interface TextFileRead {
  readonly text: string | null;
  readonly version: string | null;
}

/** A file's version: the SHA-256 of its bytes (text as UTF-8), in hex (PRD §3.5). */
export function versionOf(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function errorCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException).code;
}

export async function readTextFile(file: string): Promise<TextFileRead> {
  try {
    const text = await readFile(file, 'utf8');
    return { text, version: versionOf(text) };
  } catch (e) {
    if (errorCode(e) === 'ENOENT') return { text: null, version: null };
    throw e;
  }
}

/** The file a path really names: a symlink's target, so saving replaces the target and keeps the link. */
export async function realFile(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch (e) {
    if (errorCode(e) === 'ENOENT') return file;
    throw e;
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Windows refuses a rename while another program (a virus scanner, a sync client) has the file open. */
async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (e) {
      const code = errorCode(e);
      const busy = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (process.platform !== 'win32' || !busy || attempt >= 6) throw e;
      await sleep(20 * 2 ** attempt);
    }
  }
}

/** Our own temp files, `.<name>.<12 hex>.tmp`: never listed, and left by a crash at worst. */
export const TEMP_FILE = /^\..+\.[0-9a-f]{12}\.tmp$/;

/**
 * Writes `data` (text as UTF-8, or bytes) to `file` atomically, creating the folder if needed. A symlinked file
 * keeps its link: the data replaces the file the link points at.
 */
export async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const target = await realFile(file);
  const dir = path.dirname(target);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameRetrying(tmp, target);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  await syncFolder(dir);
}

/** Errors from flushing a folder that mean the file system can't do it, not that the save failed. */
const CANNOT_FLUSH_FOLDER = new Set(['EINVAL', 'ENOTSUP', 'EISDIR', 'EBADF', 'EPERM', 'EACCES']);

/**
 * Flushes a folder so a rename in it survives a crash. Windows can't open folders, and some file systems
 * (network shares, FAT) can't flush them; the rename has already happened either way, so those cases return
 * quietly. Any other error is thrown.
 */
export async function syncFolder(dir: string): Promise<void> {
  if (process.platform === 'win32') return;
  let handle;
  try {
    handle = await open(dir, 'r');
  } catch (e) {
    if (CANNOT_FLUSH_FOLDER.has(errorCode(e) ?? '')) return;
    throw e;
  }
  try {
    await handle.sync();
  } catch (e) {
    if (!CANNOT_FLUSH_FOLDER.has(errorCode(e) ?? '')) throw e;
  } finally {
    await handle.close();
  }
}
