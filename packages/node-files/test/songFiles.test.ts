import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memorySource, readTags } from '@playlark/core';
import { tagResult, writeSongTags, type FileFacts } from '../src/index.ts';

const FIXTURE = fileURLToPath(
  new URL('../../../e2e/fixtures/basic/Northwind Quartet/Harbour Lights/02 Salt Air.flac', import.meta.url),
);
const REL = 'Album/02 Salt Air.flac';
const NOW = new Date(2026, 10, 19);

let dir: string;
let root: string;
let data: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'playlark-songs-'));
  root = path.join(dir, 'Music');
  data = path.join(dir, 'data');
  await mkdir(path.join(root, 'Album'), { recursive: true });
  await copyFile(FIXTURE, path.join(root, REL));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const factsOf = async (): Promise<FileFacts> => {
  const s = await stat(path.join(root, REL));
  return { size: s.size, mtime: Math.round(s.mtimeMs) };
};
const titleOf = async () => {
  const r = await readTags(memorySource(new Uint8Array(await readFile(path.join(root, REL)))), REL);
  return r.ok ? r.tags.title : r.error;
};

describe('saving tags (§11.3)', () => {
  it('writes the new tags, keeps the original in the trash, and the undo edit puts them back', async () => {
    const before = await titleOf();
    const original = await readFile(path.join(root, REL));
    const saved = await writeSongTags(root, REL, { title: 'Sea Salt' }, await factsOf(), data, NOW);
    expect(await titleOf()).toBe('Sea Salt');
    expect(saved.file).toEqual(await factsOf());
    expect(await readFile(path.join(data, 'trash/2026-11-19/Album/02 Salt Air.flac'))).toEqual(original);
    expect((await readdir(path.join(root, 'Album'))).filter((n) => n.endsWith('.tmp'))).toEqual([]);

    await writeSongTags(root, REL, saved.undo, saved.file, data, NOW);
    expect(await titleOf()).toBe(before);
    expect(await readdir(path.join(data, 'trash/2026-11-19/Album'))).toHaveLength(2);
  });

  it('leaves a file that changed since it was read', async () => {
    const facts = await factsOf();
    await utimes(path.join(root, REL), new Date(2020, 0, 1), new Date(2020, 0, 1));
    const result = await tagResult(REL, () => writeSongTags(root, REL, { title: 'x' }, facts, data, NOW));
    expect(result).toEqual({
      ok: false,
      code: 'changed',
      message: '02 Salt Air.flac changed somewhere else. Close Song Info and try again.',
    });
    expect(await titleOf()).not.toBe('x');
  });

  it('a failed check leaves the file as it was and says so', async () => {
    await writeFile(path.join(root, 'Album/bad.mp3'), new Uint8Array(4000));
    const s = await stat(path.join(root, 'Album/bad.mp3'));
    const result = await tagResult('Album/bad.mp3', () =>
      writeSongTags(
        root,
        'Album/bad.mp3',
        { title: 'x' },
        { size: s.size, mtime: Math.round(s.mtimeMs) },
        data,
      ),
    );
    expect(result).toMatchObject({ ok: false, code: 'failed' });
    expect(result.ok ? '' : result.message).toMatch(/^Couldn’t save bad\.mp3: /);
    expect(await readFile(path.join(root, 'Album/bad.mp3'))).toEqual(Buffer.alloc(4000));
  });

  it('refuses a path outside the folder', async () => {
    await expect(
      writeSongTags(root, '../x.mp3', { title: 'x' }, { size: 0, mtime: 0 }, data),
    ).rejects.toMatchObject({
      code: 'outside',
    });
  });
});
