import { describe, expect, it } from 'vitest';
import {
  NO_STATS,
  applyStatsChanges,
  parseStatsChanges,
  statsChanges,
  type FolderStats,
} from '../src/index.ts';

const stats = (entries: Record<string, Partial<typeof NO_STATS>>): FolderStats =>
  new Map(Object.entries(entries).map(([p, s]) => [p, { ...NO_STATS, ...s }]));

describe('stats shared through a server (§18.2)', () => {
  it('sends only what changed, and plays from two devices add up', () => {
    const base = stats({ a: { plays: 2, added: 5 }, b: { favourite: true }, gone: { plays: 1 } });
    const phone = stats({
      a: { plays: 3, lastPlayed: 100, added: 5 },
      b: { favourite: false },
      c: { added: 9 },
    });
    const changes = statsChanges(base, phone);
    expect(changes).toEqual([
      { path: 'a', plays: 1, lastPlayed: 100 },
      { path: 'b', favourite: false },
      { path: 'c', added: 9 },
      { path: 'gone', removed: true },
    ]);
    // Meanwhile the laptop played `a` twice and starred `c`.
    const server = stats({
      a: { plays: 4, lastPlayed: 200, added: 5 },
      b: { favourite: true },
      c: { favourite: true },
      gone: { plays: 1 },
    });
    const merged = applyStatsChanges(server, changes);
    expect(merged.get('a')).toEqual({ favourite: false, plays: 5, lastPlayed: 200, added: 5 });
    expect(merged.get('b')!.favourite).toBe(false);
    expect(merged.get('c')).toEqual({ ...NO_STATS, favourite: true, added: 9 });
    expect(merged.has('gone')).toBe(false);
    expect(statsChanges(phone, phone)).toEqual([]);
  });

  it('takes only well-formed changes from a request', () => {
    expect(parseStatsChanges([{ path: 'a', plays: 1, favourite: true }])).toEqual([
      { path: 'a', plays: 1, favourite: true },
    ]);
    for (const bad of [
      {},
      [{ path: '' }],
      [{ path: 'a', plays: -1 }],
      [{ path: 'a', plays: 1.5 }],
      [{ path: 'a', favourite: 'yes' }],
      [{ path: 'a', removed: false }],
      [{ path: 'a', lastPlayed: 'now' }],
      [{ path: 'a', extra: 1 }],
    ])
      expect(parseStatsChanges(bad)).toBeNull();
  });
});

describe('base64 for covers sent over HTTP', () => {
  it('round-trips every length', async () => {
    const { decodeBase64, encodeBase64 } = await import('../src/index.ts');
    for (let n = 0; n < 8; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 200) & 0xff);
      const text = encodeBase64(bytes);
      expect(text).toBe(Buffer.from(bytes).toString('base64'));
      expect(decodeBase64(text)).toEqual(bytes);
    }
  });
});
