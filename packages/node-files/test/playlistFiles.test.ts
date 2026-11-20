import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  emptyOldTrash,
  playlistResult,
  renamePlaylistFile,
  trashPlaylistFile,
  versionOf,
  writePlaylistFile,
} from '../src/index.ts';

let dir: string;
let root: string;
let data: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'playlark-playlists-'));
  root = path.join(dir, 'Music');
  data = path.join(dir, 'data');
  await mkdir(root);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (rel: string) => readFile(path.join(root, rel), 'utf8');

describe('playlist writes', () => {
  it('creates a playlist and its folder, then saves only over the version it read', async () => {
    const v1 = await writePlaylistFile(root, 'Playlists/Mix.m3u8', bytes('#EXTM3U\n'), null);
    expect(v1).toBe(versionOf(bytes('#EXTM3U\n')));
    expect(await text('Playlists/Mix.m3u8')).toBe('#EXTM3U\n');
    const v2 = await writePlaylistFile(root, 'Playlists/Mix.m3u8', bytes('#EXTM3U\na.mp3\n'), v1);
    await expect(writePlaylistFile(root, 'Playlists/Mix.m3u8', bytes('x'), v1)).rejects.toMatchObject({
      code: 'changed',
    });
    await expect(writePlaylistFile(root, 'Playlists/Mix.m3u8', bytes('x'), null)).rejects.toMatchObject({
      code: 'exists',
    });
    await expect(writePlaylistFile(root, 'Playlists/Gone.m3u8', bytes('x'), v2)).rejects.toMatchObject({
      code: 'deleted',
    });
    expect(await text('Playlists/Mix.m3u8')).toBe('#EXTM3U\na.mp3\n');
    expect((await readdir(path.join(root, 'Playlists'))).sort()).toEqual(['Mix.m3u8']);
  });

  it('never writes anything but a playlist inside the folder', async () => {
    await mkdir(path.join(dir, 'outside'));
    await symlink(path.join(dir, 'outside'), path.join(root, 'Away'));
    for (const rel of [
      'song.mp3',
      '../x.m3u8',
      '/x.m3u8',
      'a/../x.m3u8',
      'Away/x.m3u8',
      'a\\x.m3u8',
      '.hidden.m3u8',
    ])
      await expect(writePlaylistFile(root, rel, bytes('x'), null)).rejects.toMatchObject({ code: 'outside' });
    expect(await readdir(path.join(dir, 'outside'))).toEqual([]);
  });

  it('saves through a link to the file it points at, keeping the link', async () => {
    await writeFile(path.join(root, 'real.m3u8'), 'a');
    await symlink('real.m3u8', path.join(root, 'link.m3u8'));
    await writePlaylistFile(root, 'link.m3u8', bytes('b'), versionOf('a'));
    expect(await text('real.m3u8')).toBe('b');
    expect(await text('link.m3u8')).toBe('b');
  });

  it('renames, even when only the case changes, and never over another playlist', async () => {
    await writeFile(path.join(root, 'mix.m3u8'), 'a');
    await writeFile(path.join(root, 'Other.m3u8'), 'b');
    await expect(renamePlaylistFile(root, 'mix.m3u8', 'Other.m3u8')).rejects.toMatchObject({
      code: 'exists',
    });
    expect(await renamePlaylistFile(root, 'mix.m3u8', 'Mix.m3u8')).toBe(versionOf('a'));
    expect((await readdir(root)).sort()).toEqual(['Mix.m3u8', 'Other.m3u8']);
    await expect(renamePlaylistFile(root, 'gone.m3u8', 'x.m3u8')).rejects.toMatchObject({ code: 'deleted' });
  });

  it('moves a deleted playlist to the dated trash, keeping its path, and empties old trash', async () => {
    const day = new Date(2026, 10, 19, 12);
    await mkdir(path.join(root, 'Playlists'));
    for (const n of [1, 2]) {
      await writeFile(path.join(root, 'Playlists/Mix.m3u8'), `v${n}`);
      await expect(trashPlaylistFile(root, 'Playlists/Mix.m3u8', 'nope', data, day)).rejects.toMatchObject({
        code: 'changed',
      });
      await trashPlaylistFile(root, 'Playlists/Mix.m3u8', versionOf(`v${n}`), data, day);
    }
    const trashed = path.join(data, 'trash', '2026-11-19', 'Playlists');
    expect((await readdir(trashed)).sort()).toEqual(['Mix 2.m3u8', 'Mix.m3u8']);
    expect(await readFile(path.join(trashed, 'Mix 2.m3u8'), 'utf8')).toBe('v2');
    expect(await readdir(path.join(root, 'Playlists'))).toEqual([]);
    await mkdir(path.join(data, 'trash', '2026-10-01'));
    await emptyOldTrash(data, day);
    expect(await readdir(path.join(data, 'trash'))).toEqual(['2026-11-19']);
    await emptyOldTrash(data, new Date(2026, 11, 20));
    expect(await readdir(path.join(data, 'trash'))).toEqual([]);
  });

  it('reports the outcome as a result for the bridge', async () => {
    expect(await playlistResult(() => writePlaylistFile(root, 'a.m3u8', bytes('x'), null))).toEqual({
      ok: true,
      version: versionOf('x'),
    });
    expect(await playlistResult(() => writePlaylistFile(root, 'a.m3u8', bytes('x'), null))).toMatchObject({
      ok: false,
      code: 'exists',
    });
    expect(await playlistResult(() => Promise.reject(new Error('disk full')))).toEqual({
      ok: false,
      code: 'failed',
      message: 'disk full',
    });
  });
});
