import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listMusicFiles, mediaReply, parseRange, resolveInside } from '../src/index.ts';

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'playlark-folder-'));
  outside = await mkdtemp(path.join(tmpdir(), 'playlark-outside-'));
  await mkdir(path.join(root, 'Artist/Album'), { recursive: true });
  await mkdir(path.join(root, '.hidden'));
  await writeFile(path.join(root, 'Artist/Album/01 Song.mp3'), 'abcdefghij');
  await writeFile(path.join(root, 'Artist/Album/cover.jpg'), 'x');
  await writeFile(path.join(root, '.hidden/secret.mp3'), 'x');
  await writeFile(path.join(root, 'Loose.flac'), '');
  await writeFile(path.join(outside, 'elsewhere.mp3'), 'x');
  await symlink(outside, path.join(root, 'Linked'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('the music folder', () => {
  it('lists music files, skipping hidden ones and symlinked folders', async () => {
    const files = await listMusicFiles(root);
    expect(files.map((f) => f.path)).toEqual(['Artist/Album/01 Song.mp3', 'Loose.flac']);
    expect(files[0]!.size).toBe(10);
  });

  it('refuses paths that leave the folder', async () => {
    for (const bad of [
      '../x.mp3',
      'Artist/../../x.mp3',
      '/etc/passwd',
      'a\\b.mp3',
      '',
      'a//b.mp3',
      'Linked/elsewhere.mp3',
    ])
      await expect(resolveInside(root, bad)).rejects.toMatchObject({
        code: expect.stringMatching(/outside|not-found/),
      });
    await expect(resolveInside(root, 'Linked/elsewhere.mp3')).rejects.toMatchObject({ code: 'outside' });
    await expect(resolveInside(root, 'Gone.mp3')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('reads Range headers', () => {
    expect(parseRange(undefined, 10)).toBeNull();
    expect(parseRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(parseRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=8-100', 10)).toEqual({ start: 8, end: 9 });
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,4-5', 10)).toBeNull();
  });

  it('answers song requests whole, in part, or not at all', async () => {
    const whole = await mediaReply(root, 'Artist/Album/01 Song.mp3', undefined);
    expect(whole).toMatchObject({ status: 200, body: { start: 0, end: 9 } });
    expect(whole.headers['Content-Type']).toBe('audio/mpeg');
    const part = await mediaReply(root, 'Artist/Album/01 Song.mp3', 'bytes=2-4');
    expect(part).toMatchObject({ status: 206, body: { start: 2, end: 4 } });
    expect(part.headers['Content-Range']).toBe('bytes 2-4/10');
    expect((await mediaReply(root, 'Artist/Album/01 Song.mp3', 'bytes=20-')).status).toBe(416);
    await expect(mediaReply(root, 'Artist/Album/cover.jpg', undefined)).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(mediaReply(root, '../elsewhere.mp3', undefined)).rejects.toMatchObject({ code: 'outside' });
  });
});
