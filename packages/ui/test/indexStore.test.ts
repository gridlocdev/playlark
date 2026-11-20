import { describe, expect, it } from 'vitest';
import { makeIndex, playFrom, saveQueue, type Song } from '@playlark/core';
import { bridgeIndexStore, memoryIndexStore, type IndexBridge } from '../src/index.ts';

const picture = { mime: 'image/png', type: 3, data: new Uint8Array([1, 2]) };
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('index stores', () => {
  it('keeps the index in memory, for one folder at a time', async () => {
    const store = memoryIndexStore();
    expect(await store.load('/Music')).toBeNull();
    await store.save(makeIndex('/Music', [], new Date(0)));
    expect((await store.load('/Music'))?.root).toBe('/Music');
    expect(await store.load('/Other')).toBeNull();
    await store.saveCover(A, picture);
    await store.saveCover(B, picture);
    await store.pruneCovers(new Set([B]));
    expect(await store.coverUrl(A)).toBeNull();
    expect(await store.coverUrl(B)).not.toBeNull();
  });

  it('goes through the desktop bridge, and serves only covers it knows', async () => {
    let text: string | null = null;
    let queue: string | null = null;
    const calls: string[] = [];
    const bridge: IndexBridge = {
      load: () => Promise.resolve(text),
      save: (t) => {
        text = t;
        return Promise.resolve();
      },
      saveCover: (id, mime) => {
        calls.push(`cover ${id.slice(0, 1)} ${mime}`);
        return Promise.resolve();
      },
      pruneCovers: (keep) => {
        calls.push(`prune ${keep.length}`);
        return Promise.resolve();
      },
      loadQueue: () => Promise.resolve(queue),
      saveQueue: (t) => {
        queue = t;
        return Promise.resolve();
      },
      loadStats: () => Promise.resolve(null),
      saveStats: () => Promise.resolve(),
    };
    const store = bridgeIndexStore(bridge, (id) => `app://playlark/cover/${id}`);
    expect(await store.coverUrl(A)).toBeNull();
    await store.saveCover(A, picture);
    expect(await store.coverUrl(A)).toBe(`app://playlark/cover/${A}`);
    await store.pruneCovers(new Set([A]));
    expect(calls).toEqual(['cover a image/png', 'prune 1']);

    // A later run learns the covers from the saved index.
    const song: Song = {
      path: 'x.mp3',
      size: 1,
      mtime: 1,
      format: 'mp3',
      codec: 'mp3',
      title: 'X',
      artist: 'A',
      album: 'B',
      albumArtist: 'A',
      compilation: false,
      duration: 1,
      sampleRate: 44100,
      channels: 2,
      cover: { kind: 'embedded', id: B, mime: 'image/png' },
    };
    await store.save(makeIndex('/Music', [song], new Date(0)));
    const next = bridgeIndexStore(bridge, (id) => `app://playlark/cover/${id}`);
    expect(await next.coverUrl(B)).toBeNull();
    expect((await next.load('/Music'))?.songs).toHaveLength(1);
    expect(await next.coverUrl(B)).toBe(`app://playlark/cover/${B}`);
  });

  it('keeps the play queue for its folder only', async () => {
    let queue: string | null = null;
    const none = () => Promise.resolve();
    const bridge: IndexBridge = {
      load: () => Promise.resolve(null),
      save: none,
      saveCover: none,
      pruneCovers: none,
      loadQueue: () => Promise.resolve(queue),
      saveQueue: (t) => {
        queue = t;
        return Promise.resolve();
      },
      loadStats: () => Promise.resolve(null),
      saveStats: none,
    };
    const saved = saveQueue('/Music', playFrom(['a.mp3', 'b.mp3'], 1), 30);
    for (const store of [memoryIndexStore(), bridgeIndexStore(bridge, String)]) {
      expect(await store.loadQueue('/Music')).toBeNull();
      await store.saveQueue(saved);
      expect(await store.loadQueue('/Music')).toEqual(saved);
      expect(await store.loadQueue('/Other')).toBeNull();
    }
  });

  it('keeps each folder’s stats in one file, and never writes over a file it can’t read', async () => {
    let text: string | null = null;
    const none = () => Promise.resolve();
    const bridge: IndexBridge = {
      load: () => Promise.resolve(null),
      save: none,
      saveCover: none,
      pruneCovers: none,
      loadQueue: () => Promise.resolve(null),
      saveQueue: none,
      loadStats: () => Promise.resolve(text),
      saveStats: (t) => {
        text = t;
        return Promise.resolve();
      },
    };
    const fav = { favourite: true, plays: 2, lastPlayed: 5, added: 1 };
    const store = bridgeIndexStore(bridge, String);
    expect((await store.loadStats('/Music')).size).toBe(0);
    await store.saveStats('/Music', new Map([['a.mp3', fav]]));
    await store.loadStats('/Other');
    await store.saveStats('/Other', new Map([['b.mp3', { ...fav, favourite: false }]]));
    const again = bridgeIndexStore(bridge, String);
    expect((await again.loadStats('/Music')).get('a.mp3')).toEqual(fav);
    expect((await again.loadStats('/Other')).get('b.mp3')?.plays).toBe(2);

    text = '{ not json';
    const broken = bridgeIndexStore(bridge, String);
    await expect(broken.loadStats('/Music')).rejects.toThrow(/can’t be read/);
    await expect(broken.saveStats('/Music', new Map())).rejects.toThrow(/can’t be read/);
    expect(text).toBe('{ not json');

    const memory = memoryIndexStore();
    await memory.saveStats('/Music', new Map([['a.mp3', fav]]));
    expect((await memory.loadStats('/Music')).get('a.mp3')).toEqual(fav);
    expect((await memory.loadStats('/Other')).size).toBe(0);
  });
});
