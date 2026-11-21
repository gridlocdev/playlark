import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseIndex, parseStatsFile, readTags, memorySource, sha256Hex, type Song } from '@playlark/core';
import { createServer, type PlaylarkServer } from '../src/index.ts';

const FIXTURES = fileURLToPath(new URL('../../../e2e/fixtures/', import.meta.url));
const FLAC = 'Northwind Quartet/Harbour Lights/02 Salt Air.flac';
const dir = mkdtempSync(path.join(tmpdir(), 'playlark-api-'));
const music = path.join(dir, 'Music');
const data = path.join(dir, 'data');
let server: PlaylarkServer;
let readOnly: PlaylarkServer;
let base: string;
let readOnlyBase: string;

const listen = async (s: PlaylarkServer) => {
  await new Promise<void>((resolve) => s.http.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(s.http.address() as AddressInfo).port}`;
};
const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const encode = (p: string) => p.split('/').map(encodeURIComponent).join('/');

beforeAll(async () => {
  cpSync(path.join(FIXTURES, 'basic'), music, { recursive: true });
  // A song with its cover inside it.
  cpSync(path.join(FIXTURES, 'covers/Gallery/framed.mp3'), path.join(music, 'Gallery/framed.mp3'));
  server = createServer({ staticDir: null, musicDir: music, dataDir: data, poll: true });
  readOnly = createServer({
    staticDir: null,
    musicDir: music,
    dataDir: path.join(dir, 'data-ro'),
    poll: true,
    readOnly: true,
  });
  base = await listen(server);
  readOnlyBase = await listen(readOnly);
  await server.library!.scan();
});

afterAll(async () => {
  await server.close();
  await readOnly.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the library the server read (§18.2, §18.3)', () => {
  it('gives the index with an ETag, and 304 when the page has it', async () => {
    const r = await fetch(`${base}/api/library`);
    expect(r.status).toBe(200);
    const index = parseIndex(await r.text(), 'Music');
    expect(index?.songs.map((s) => s.path)).toContain(FLAC);
    const etag = r.headers.get('etag')!;
    expect((await fetch(`${base}/api/library`, { headers: { 'If-None-Match': etag } })).status).toBe(304);
  });

  it('serves the covers it found, by their SHA-256', async () => {
    const index = parseIndex(await (await fetch(`${base}/api/library`)).text(), 'Music')!;
    const embedded = index.songs.find((s: Song) => s.cover?.kind === 'embedded')!;
    const id = embedded.cover!.kind === 'embedded' ? embedded.cover!.id : '';
    const r = await fetch(`${base}/api/covers/${id}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('immutable');
    expect(sha256Hex(new Uint8Array(await r.arrayBuffer()))).toBe(id);
    expect((await fetch(`${base}/api/covers/${'0'.repeat(64)}`)).status).toBe(404);
    expect((await fetch(`${base}/api/covers/..%2Fstats.json`)).status).toBe(404);
  });

  it('says on the event stream when the library changed', async () => {
    const controller = new AbortController();
    const r = await fetch(`${base}/api/events`, { signal: controller.signal });
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    const reader = r.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toMatch(/^event: library\ndata: \{"etag":/);
    controller.abort();
  });
});

describe('favourites and play counts shared by every device (§18.2)', () => {
  it('adds up the plays each device sends', async () => {
    const send = (changes: unknown) => fetch(`${base}/api/stats`, json({ changes }));
    expect((await send([{ path: FLAC, plays: 1, lastPlayed: 10 }])).status).toBe(200);
    expect((await send([{ path: FLAC, plays: 2, favourite: true, lastPlayed: 5 }])).status).toBe(200);
    const stats = parseStatsFile(await (await fetch(`${base}/api/stats`)).text())!.get('Music')!;
    expect(stats.get(FLAC)).toEqual({ favourite: true, plays: 3, lastPlayed: 10, added: null });
    expect((await send([{ path: FLAC, plays: -1 }])).status).toBe(400);
  });
});

describe('writes to the music folder (§9.3, §11.3)', () => {
  it('creates, renames and trashes a playlist, each against the version last read', async () => {
    const at = `${base}/api/playlists/${encode('Playlists/Road.m3u8')}`;
    const bytes = new TextEncoder().encode('#EXTM3U\n');
    const made = await fetch(at, { method: 'PUT', headers: { 'If-None-Match': '*' }, body: bytes });
    expect(await made.json()).toEqual({ ok: true, version: sha256Hex(bytes) });
    const again = await fetch(at, { method: 'PUT', headers: { 'If-None-Match': '*' }, body: bytes });
    expect(again.status).toBe(409);
    const stale = await fetch(at, {
      method: 'PUT',
      headers: { 'If-Match': `"${'0'.repeat(64)}"` },
      body: bytes,
    });
    expect(stale.status).toBe(412);
    expect((await stale.json()) as { code: string }).toMatchObject({ ok: false, code: 'changed' });

    const renamed = await fetch(at, json({ to: 'Playlists/Trip.m3u8' }));
    expect(renamed.status).toBe(200);
    const trip = `${base}/api/playlists/${encode('Playlists/Trip.m3u8')}`;
    const gone = await fetch(trip, { method: 'DELETE', headers: { 'If-Match': `"${sha256Hex(bytes)}"` } });
    expect(gone.status).toBe(200);
    expect(existsSync(path.join(music, 'Playlists/Trip.m3u8'))).toBe(false);
    expect(
      (
        await fetch(`${base}/api/playlists/${'a%2F..%2Fx.m3u8'}`, {
          method: 'PUT',
          headers: { 'If-None-Match': '*' },
          body: bytes,
        })
      ).status,
    ).toBe(403);
  });

  it('writes tags with the same checks, and gives the undo edit', async () => {
    const file = path.join(music, FLAC);
    const { files } = (await (await fetch(`${base}/api/files`)).json()) as {
      files: { path: string; size: number; mtime: number }[];
    };
    const { size, mtime } = files.find((f) => f.path === FLAC)!;
    const r = await fetch(
      `${base}/api/tags`,
      json({ path: FLAC, edit: { title: 'Sea Salt' }, expected: { size, mtime } }),
    );
    const result = (await r.json()) as { ok: boolean; undo: { title: string } };
    expect(result.ok).toBe(true);
    const read = await readTags(memorySource(new Uint8Array(readFileSync(file))), FLAC);
    expect(read.ok && read.tags.title).toBe('Sea Salt');
    expect(result.undo.title).toBe('Salt Air');
    const stale = await fetch(
      `${base}/api/tags`,
      json({ path: FLAC, edit: { title: 'x' }, expected: { size, mtime } }),
    );
    expect(stale.status).toBe(412);
  });

  it('refuses a write from another site’s page', async () => {
    const r = await fetch(`${base}/api/stats`, {
      ...json({ changes: [] }),
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
    });
    expect(r.status).toBe(403);
    const form = await fetch(`${base}/api/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"changes":[]}',
    });
    expect(form.status).toBe(415);
  });

  it('refuses every write to the music folder when started read-only (§18.1)', async () => {
    expect(await (await fetch(`${readOnlyBase}/api/info`)).json()).toMatchObject({ readOnly: true });
    const r = await fetch(
      `${readOnlyBase}/api/tags`,
      json({ path: FLAC, edit: { title: 'x' }, expected: { size: 1, mtime: 1 } }),
    );
    expect(r.status).toBe(403);
    const p = await fetch(`${readOnlyBase}/api/playlists/${encode('Playlists/A.m3u8')}`, {
      method: 'PUT',
      headers: { 'If-None-Match': '*' },
      body: '#EXTM3U\n',
    });
    expect(p.status).toBe(403);
  });
});
