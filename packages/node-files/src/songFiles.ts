/**
 * Saving a song's tags (PRD §11.3): the new file goes to a temp file beside it, is read back and checked, the
 * original goes to Playlark's trash, then the temp file takes its place. A file changed since it was read is left.
 */
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { type TagEdit, TagCheckError, rewriteTags } from '@playlark/core';
import { syncFolder } from './atomic.ts';
import { FolderError } from './errors.ts';
import { withLockFile } from './lockFile.ts';
import { resolveInside } from './musicFolder.ts';
import { trashPath } from './playlistFiles.ts';

/** A song file's size and modified time (ms, rounded as the folder listing gives it). */
export interface FileFacts {
  readonly size: number;
  readonly mtime: number;
}

/** What a tag save gives back over IPC or HTTP. */
export type TagResult =
  | { readonly ok: true; readonly file: FileFacts; readonly undo: TagEdit }
  | { readonly ok: false; readonly code: 'changed' | 'failed'; readonly message: string };

async function facts(file: string): Promise<FileFacts> {
  const s = await stat(file);
  return { size: s.size, mtime: Math.round(s.mtimeMs) };
}

const changed = (name: string) =>
  new FolderError('changed', `${name} changed somewhere else. Close Song Info and try again.`);

async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await copyFile(from, to);
    await rm(from);
  }
}

/**
 * Writes `edit` into the song at `rel` inside `root`, if it still has the size and time `expected` (§11.3).
 * The original goes to `trash/<date>/<rel>` in `dataDir`. Gives the new facts and the edit that undoes this one.
 */
export async function writeSongTags(
  root: string,
  rel: string,
  edit: TagEdit,
  expected: FileFacts,
  dataDir: string,
  now = new Date(),
): Promise<{ file: FileFacts; undo: TagEdit }> {
  const file = await resolveInside(root, rel);
  const name = path.basename(rel);
  return withLockFile(file, async () => {
    const same = (f: FileFacts) => f.size === expected.size && f.mtime === expected.mtime;
    if (!same(await facts(file))) throw changed(name);
    const original = new Uint8Array(await readFile(file));
    const { bytes, undo } = await rewriteTags(original, rel, edit);
    if (!bytes) return { file: expected, undo };
    const dir = path.dirname(file);
    const tmp = path.join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      const handle = await open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Read back what reached the disk: it must be the bytes that passed the check.
      if (!Buffer.from(await readFile(tmp)).equals(Buffer.from(bytes)))
        throw new TagCheckError('the file read back differs');
      if (!same(await facts(file))) throw changed(name);
      const trashed = await trashPath(dataDir, rel, now);
      await moveFile(file, trashed);
      try {
        await rename(tmp, file);
      } catch (e) {
        await moveFile(trashed, file);
        throw e;
      }
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    await syncFolder(dir);
    return { file: await facts(file), undo };
  });
}

/** Runs `writeSongTags` and turns its outcome into a `TagResult`, with the message the user sees (§11.3). */
export async function tagResult(
  rel: string,
  write: () => Promise<{ file: FileFacts; undo: TagEdit }>,
): Promise<TagResult> {
  try {
    return { ok: true, ...(await write()) };
  } catch (e) {
    const name = path.basename(rel);
    if (e instanceof FolderError && e.code === 'changed')
      return { ok: false, code: 'changed', message: e.message };
    if (e instanceof TagCheckError)
      return {
        ok: false,
        code: 'failed',
        message: `Couldn’t save ${name}: the check after writing failed. The file wasn’t changed.`,
      };
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, code: 'failed', message: `Couldn’t save ${name}: ${reason}` };
  }
}
