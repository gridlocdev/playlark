import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFolderChoice, mediaPath, mediaResponse, saveFolderChoice, startFolder } from '../src/index.ts';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'playlark-media-'));
  await mkdir(path.join(root, 'A B'));
  await writeFile(path.join(root, 'A B/Sóng #1.mp3'), '0123456789');
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe('app://playlark/media/', () => {
  it('decodes each part of the path', () => {
    expect(mediaPath('/media/A%20B/S%C3%B3ng%20%231.mp3')).toBe('A B/Sóng #1.mp3');
    expect(mediaPath('/index.html')).toBeNull();
    expect(mediaPath('/media/%E0')).toBeNull();
  });

  it('serves a song whole and in ranges', async () => {
    const url = '/media/A%20B/S%C3%B3ng%20%231.mp3';
    const whole = await mediaResponse(root, url, null);
    expect(whole.status).toBe(200);
    expect(await whole.text()).toBe('0123456789');
    const part = await mediaResponse(root, url, 'bytes=3-5');
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 3-5/10');
    expect(await part.text()).toBe('345');
  });

  it('refuses paths outside the folder, missing files and no folder', async () => {
    expect((await mediaResponse(root, '/media/..%2F..%2Fetc%2Fpasswd', null)).status).toBe(403);
    expect((await mediaResponse(root, '/media/Gone.mp3', null)).status).toBe(404);
    expect((await mediaResponse(null, '/media/A%20B/x.mp3', null)).status).toBe(404);
  });
});

describe('the music folder choice', () => {
  it('remembers the folder, and PLAYLARK_MUSIC wins', async () => {
    const file = path.join(root, 'profile/folder.json');
    expect(await loadFolderChoice(file)).toBeNull();
    await saveFolderChoice(file, '/Music');
    expect(await startFolder({}, file)).toBe('/Music');
    expect(await startFolder({ PLAYLARK_MUSIC: '/Fixtures' }, file)).toBe('/Fixtures');
  });
});
