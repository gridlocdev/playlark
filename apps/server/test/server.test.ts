import http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bindProblem,
  createServer,
  DEFAULT_PORT,
  hostAllowed,
  mediaPath,
  parseHosts,
  parsePort,
} from '../src/index.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'playlark-server-'));
const music = path.join(dir, 'music');
const server = createServer({ staticDir: path.join(dir, 'web'), musicDir: music, allowedHosts: ['nas.lan'] });
let base: string;

beforeAll(async () => {
  mkdirSync(path.join(dir, 'web', 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'web', 'index.html'), '<title>Playlark</title>');
  writeFileSync(path.join(dir, 'web', 'assets', 'app-1.js'), 'export {};');
  writeFileSync(path.join(dir, 'secret.mp3'), 'outside');
  mkdirSync(path.join(music, 'Band', 'Album'), { recursive: true });
  writeFileSync(path.join(music, 'Band', 'Album', '01 Song #1.mp3'), '0123456789');
  writeFileSync(path.join(music, 'notes.txt'), 'private');
  symlinkSync(path.join(dir, 'secret.mp3'), path.join(music, 'link.mp3'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const song = `/api/media/Band/Album/${encodeURIComponent('01 Song #1.mp3')}`;

describe('the API', () => {
  it('names the folder', async () => {
    const r = await fetch(`${base}/api/info`);
    expect(await r.json()).toEqual({ app: 'Playlark', name: 'music' });
  });

  it('lists the music files only', async () => {
    const r = await fetch(`${base}/api/files`);
    const { files } = (await r.json()) as { files: { path: string }[] };
    expect(files.map((f) => f.path)).toEqual(['Band/Album/01 Song #1.mp3']);
  });

  it('serves a song whole and in ranges', async () => {
    const whole = await fetch(`${base}${song}`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('audio/mpeg');
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(await whole.text()).toBe('0123456789');
    const part = await fetch(`${base}${song}`, { headers: { Range: 'bytes=2-4' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await part.text()).toBe('234');
    const past = await fetch(`${base}${song}`, { headers: { Range: 'bytes=50-' } });
    expect(past.status).toBe(416);
  });

  it('answers HEAD without a body', async () => {
    const r = await fetch(`${base}${song}`, { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-length')).toBe('10');
  });

  it('refuses files outside the folder and files that are not music', async () => {
    expect((await fetch(`${base}/api/media/..%2Fsecret.mp3`)).status).toBe(403);
    expect((await fetch(`${base}/api/media/link.mp3`)).status).toBe(403);
    expect((await fetch(`${base}/api/media/notes.txt`)).status).toBe(404);
    expect((await fetch(`${base}/api/media/missing.mp3`)).status).toBe(404);
    expect((await fetch(`${base}/api/media/%E0%A4%A`)).status).toBe(400);
  });

  it('refuses writes', async () => {
    expect((await fetch(`${base}/api/files`, { method: 'POST' })).status).toBe(405);
  });

  it('refuses unknown host names', async () => {
    // fetch can't set Host, so ask with node:http.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      http
        .get(`${base}/api/info`, { headers: { Host: 'evil.example' } }, (r) => {
          r.resume();
          resolve(r.statusCode);
        })
        .on('error', reject);
    });
    expect(status).toBe(421);
  });
});

describe('the web client', () => {
  it('serves the shell for unknown routes and caches only hashed assets', async () => {
    const shell = await fetch(`${base}/songs`);
    expect(await shell.text()).toContain('Playlark');
    expect(shell.headers.get('cache-control')).toBe('no-cache');
    const asset = await fetch(`${base}/assets/app-1.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
  });

  it('never serves files outside the build', async () => {
    const r = await fetch(`${base}/..%2Fsecret.mp3`);
    expect(await r.text()).not.toContain('outside');
  });
});

describe('settings', () => {
  it('reads the port and host names', () => {
    expect(parsePort(undefined)).toBe(DEFAULT_PORT);
    expect(parsePort('9000')).toBe(9000);
    expect(parsePort('nope')).toBe(DEFAULT_PORT);
    expect(parseHosts(' NAS.lan, music.example.com ,')).toEqual(['nas.lan', 'music.example.com']);
  });

  it('answers localhost, IP addresses and the named hosts', () => {
    expect(hostAllowed('localhost:8830', [])).toBe(true);
    expect(hostAllowed('192.168.1.5', [])).toBe(true);
    expect(hostAllowed('[::1]:8830', [])).toBe(true);
    expect(hostAllowed('nas.lan', ['nas.lan'])).toBe(true);
    expect(hostAllowed('evil.example', ['nas.lan'])).toBe(false);
    expect(hostAllowed(undefined, [])).toBe(false);
  });

  it('only listens beyond this machine when told a proxy asks for a login', () => {
    expect(bindProblem('127.0.0.1', false)).toBeNull();
    expect(bindProblem('0.0.0.0', false)).toContain('PLAYLARK_NO_AUTH');
    expect(bindProblem('0.0.0.0', true)).toBeNull();
  });

  it('decodes media paths part by part', () => {
    expect(mediaPath('/api/media/a%2Fb/c%20d.mp3')).toBe('a/b/c d.mp3');
    expect(mediaPath('/api/media/%E0%A4%A')).toBeNull();
  });
});
