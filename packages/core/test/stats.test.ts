import { describe, expect, it } from 'vitest';
import {
  COUNT_AFTER,
  MOST_PLAYED,
  NO_STATS,
  type FolderStats,
  type Listening,
  type Song,
  type SongStats,
  countAfter,
  favourites,
  listen,
  mostPlayed,
  moveStats,
  noteAdded,
  parseStatsFile,
  recentlyAdded,
  sortSongsBy,
  writeStatsFile,
} from '../src/index.ts';

const DAY = 24 * 60 * 60 * 1000;

const song = (path: string, extra: Partial<Song> = {}): Song => ({
  path,
  size: 1,
  mtime: 1,
  format: 'mp3',
  codec: 'mp3',
  title: path,
  artist: 'A',
  album: 'B',
  albumArtist: 'A',
  compilation: false,
  duration: 200,
  sampleRate: 44100,
  channels: 2,
  ...extra,
});

const stats = (entries: Record<string, Partial<SongStats>>): FolderStats =>
  new Map(Object.entries(entries).map(([p, s]) => [p, { ...NO_STATS, ...s }]));

describe('the stats file (§10.1)', () => {
  it('keeps every folder’s stats, leaving out songs with nothing to keep', () => {
    const folders = new Map([
      ['/Music', stats({ 'a.mp3': { favourite: true, plays: 3, lastPlayed: 9, added: 2 }, 'b.mp3': {} })],
      ['/Other', stats({ 'c.mp3': { added: 4 } })],
    ]);
    const text = writeStatsFile(folders);
    expect(JSON.parse(text)).toEqual({
      format: 1,
      folders: {
        '/Music': { 'a.mp3': { favourite: true, plays: 3, lastPlayed: 9, added: 2 } },
        '/Other': { 'c.mp3': { added: 4 } },
      },
    });
    const back = parseStatsFile(text)!;
    expect(back.get('/Music')!.get('a.mp3')).toEqual(folders.get('/Music')!.get('a.mp3'));
    expect(back.get('/Other')!.get('c.mp3')).toEqual({ ...NO_STATS, added: 4 });
  });

  it('refuses anything it can’t read in full, so the caller leaves the file alone', () => {
    for (const text of [
      '',
      '[]',
      '{"format":2,"folders":{}}',
      '{"format":1}',
      '{"format":1,"folders":{"/M":{"a.mp3":{"plays":-1}}}}',
      '{"format":1,"folders":{"/M":{"a.mp3":{"plays":1.5}}}}',
      '{"format":1,"folders":{"/M":{"a.mp3":{"added":"yesterday"}}}}',
      '{"format":1,"folders":{"/M":7}}',
    ])
      expect(parseStatsFile(text), text).toBeNull();
  });
});

describe('counting plays (§10.2)', () => {
  it('counts after half the song or 4 minutes, whichever comes first', () => {
    expect(countAfter(100)).toBe(50);
    expect(countAfter(1000)).toBe(COUNT_AFTER);
    expect(countAfter(0)).toBe(Infinity);
  });

  /** Takes the samples in turn; gives how many counts came out and the seconds heard at the end. */
  function run(samples: readonly { play: number; playing: boolean; now: number }[], duration = 100) {
    let state: Listening | null = null;
    let counts = 0;
    for (const s of samples) {
      const r = listen(state, { ...s, duration });
      state = r.listening;
      if (r.count) counts++;
    }
    return { counts, heard: state?.heard ?? 0 };
  }
  const ticks = (play: number, from: number, to: number, playing = true) =>
    Array.from({ length: (to - from) / 250 + 1 }, (_, i) => ({ play, playing, now: from + i * 250 }));

  it('counts once per start, after enough time heard', () => {
    expect(run(ticks(1, 0, 49_750)).counts).toBe(0);
    expect(run(ticks(1, 0, 50_000)).counts).toBe(1);
    expect(run(ticks(1, 0, 100_000)).counts).toBe(1);
    expect(run([...ticks(1, 0, 60_000), ...ticks(2, 60_250, 120_250)]).counts).toBe(2);
  });

  it('adds nothing while paused', () => {
    // Paused for a minute in the middle: only the time playing counts.
    const paused = run([
      ...ticks(1, 0, 30_000),
      ...ticks(1, 30_250, 90_000, false),
      ...ticks(1, 90_250, 100_000),
    ]);
    expect(paused.counts).toBe(0);
    expect(paused.heard).toBeCloseTo(39.75, 1);
  });
});

describe('moves and dates', () => {
  it('moves a song’s stats to its new path, never over another song’s', () => {
    const before = stats({ 'old.mp3': { plays: 4 }, 'x.mp3': { plays: 1 }, 'taken.mp3': { plays: 9 } });
    const after = moveStats(
      before,
      new Map([
        ['old.mp3', 'new.mp3'],
        ['x.mp3', 'taken.mp3'],
      ]),
    );
    expect(after.get('new.mp3')?.plays).toBe(4);
    expect(after.has('old.mp3')).toBe(false);
    expect(after.get('taken.mp3')?.plays).toBe(9);
    expect(moveStats(before, new Map())).toBe(before);
  });

  it('dates new songs by their files on the first scan, by now after that', () => {
    const songs = [song('a.mp3', { mtime: 100 }), song('b.mp3', { mtime: 200 })];
    const first = noteAdded(new Map(), songs, 1_000, true);
    expect(first.get('a.mp3')?.added).toBe(100);
    const later = noteAdded(first, [...songs, song('c.mp3', { mtime: 300 })], 2_000, false);
    expect(later.get('a.mp3')?.added).toBe(100);
    expect(later.get('c.mp3')?.added).toBe(2_000);
    expect(noteAdded(later, songs, 3_000, false)).toBe(later);
  });
});

describe('collections (§6.2)', () => {
  const now = 1_000 * DAY;
  const songs = [song('a.mp3'), song('b.mp3'), song('c.mp3'), song('bad.mp3', { error: 'no' })];

  it('lists the favourites in the library’s order', () => {
    const s = stats({ 'c.mp3': { favourite: true }, 'a.mp3': { favourite: true } });
    expect(favourites(songs, s).map((x) => x.path)).toEqual(['a.mp3', 'c.mp3']);
  });

  it('lists songs added in the last 90 days, newest first', () => {
    const s = stats({
      'a.mp3': { added: now - 91 * DAY },
      'b.mp3': { added: now - 2 * DAY },
      'c.mp3': { added: now - DAY },
      'bad.mp3': { added: now },
    });
    expect(recentlyAdded(songs, s, now).map((x) => x.path)).toEqual(['c.mp3', 'b.mp3']);
    // Until a scan dates them, songs go by their files' times.
    expect(recentlyAdded([song('d.mp3', { mtime: now - DAY })], new Map(), now)).toHaveLength(1);
  });

  it('lists the top 100 by plays, ties by the one played last', () => {
    const s = stats({
      'a.mp3': { plays: 2, lastPlayed: 1 },
      'b.mp3': { plays: 2, lastPlayed: 5 },
      'c.mp3': { plays: 7 },
    });
    expect(mostPlayed(songs, s).map((x) => x.path)).toEqual(['c.mp3', 'b.mp3', 'a.mp3']);
    const many = Array.from({ length: 150 }, (_, i) => song(`${i}.mp3`));
    const all = stats(Object.fromEntries(many.map((x, i) => [x.path, { plays: i + 1 }])));
    expect(mostPlayed(many, all)).toHaveLength(MOST_PLAYED);
    expect(mostPlayed(many, all)[0]!.path).toBe('149.mp3');
  });

  it('sorts the Songs table by ♥ and Plays, the most first', () => {
    const s = stats({ 'b.mp3': { favourite: true, plays: 1 }, 'c.mp3': { plays: 5 } });
    expect(
      sortSongsBy(songs, 'plays', false, s)
        .map((x) => x.path)
        .slice(0, 2),
    ).toEqual(['c.mp3', 'b.mp3']);
    expect(sortSongsBy(songs, 'favourite', false, s)[0]!.path).toBe('b.mp3');
  });
});
