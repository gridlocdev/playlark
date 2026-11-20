/**
 * Lock files (PRD §3.4): `.<name>.lock` beside a file while a save checks its version and writes, so the desktop
 * app, the NAS server and the CLI never check and write one file at once. A lock older than 10 s was left by a
 * process that died, and is taken over.
 */
import { constants } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { sleep } from './atomic.ts';
import { FolderError } from './errors.ts';

export const LOCK_STALE_MS = 10_000;
/** How long a save waits for another's lock before giving up. */
export const LOCK_WAIT_MS = 12_000;
/** `.<name>.lock`: never listed. */
export const LOCK_FILE = /^\..+\.lock$/;

export function lockPathOf(file: string): string {
  return path.join(path.dirname(file), `.${path.basename(file)}.lock`);
}

const isCode = (e: unknown, code: string) => (e as NodeJS.ErrnoException).code === code;

/** Runs `fn` holding the lock file for `file`. The folder must exist. */
export async function withLockFile<T>(file: string, fn: () => Promise<T>, now = Date.now): Promise<T> {
  const lock = lockPathOf(file);
  const started = now();
  for (let wait = 5; ; wait = Math.min(wait * 2, 100)) {
    try {
      const handle = await open(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644);
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      break;
    } catch (e) {
      if (!isCode(e, 'EEXIST')) throw e;
    }
    const held = await stat(lock).catch(() => null);
    if (held && now() - held.mtimeMs > LOCK_STALE_MS) {
      await rm(lock, { force: true });
      continue;
    }
    if (now() - started > LOCK_WAIT_MS)
      throw new FolderError('busy', `“${path.basename(file)}” is being saved by another program.`);
    await sleep(wait);
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}
