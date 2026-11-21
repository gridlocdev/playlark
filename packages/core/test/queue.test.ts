import { describe, expect, it } from 'vitest';
import {
  EMPTY_QUEUE,
  type Queue,
  addToQueue,
  clearUpNext,
  current,
  following,
  isShuffled,
  move,
  next,
  parseSavedQueue,
  playFrom,
  playNext,
  previous,
  prune,
  removeAt,
  saveQueue,
  setShuffle,
  shuffleAll,
  shuffled,
  toggleRepeatQueue,
  toggleRepeatSong,
} from '../src/index.ts';

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

describe('the queue', () => {
  const q = playFrom(['a', 'b', 'c'], 1);

  it('plays from the chosen song and stops at the end', () => {
    expect(current(q)).toBe('b');
    expect(current(next(q)!)).toBe('c');
    expect(next(next(q)!)).toBeNull();
    expect(playFrom([], 0)).toEqual(EMPTY_QUEUE);
  });

  it('Previous restarts after 3 s, else goes back one; the first song restarts', () => {
    expect(previous(q, 10)).toEqual({ queue: q, restart: true });
    expect(current(previous(q, 1).queue)).toBe('a');
    expect(previous(playFrom(['a'], 0), 0).restart).toBe(true);
  });

  it('drops songs that are gone, keeping the playing one where it can', () => {
    expect(prune(q, (p) => p !== 'a')).toMatchObject({ items: ['b', 'c'], index: 0 });
    expect(prune(q, (p) => p !== 'b')).toMatchObject({ items: ['a', 'c'], index: 1 });
    expect(prune(q, () => false)).toEqual(EMPTY_QUEUE);
  });

  it('Repeat Queue starts again; Repeat This Song plays the song again only when it ends', () => {
    const all = toggleRepeatQueue(q);
    const one = toggleRepeatSong(q);
    expect([all.repeat, one.repeat]).toEqual(['all', 'one']);
    expect([toggleRepeatQueue(all).repeat, toggleRepeatSong(one).repeat]).toEqual(['off', 'off']);
    // Only one kind of repeat is on at a time.
    expect([toggleRepeatSong(all).repeat, toggleRepeatQueue(one).repeat]).toEqual(['one', 'all']);
    const last = { ...all, index: 2 };
    expect(current(next(last)!)).toBe('a');
    expect(following({ ...one, index: 2 })).toBe('c');
    expect(current(next({ ...one, index: 2 })!)).toBe('a');
    expect(following({ ...q, index: 2 })).toBeUndefined();
  });

  it('Play Next goes after the playing song, Add to Queue at the end', () => {
    expect(playNext(q, ['x', 'y']).items).toEqual(['a', 'b', 'x', 'y', 'c']);
    expect(addToQueue(q, ['x']).items).toEqual(['a', 'b', 'c', 'x']);
    // With nothing playing, both just add songs; nothing starts.
    expect(playNext(EMPTY_QUEUE, ['x'])).toMatchObject({ items: ['x'], index: -1 });
  });

  it('removes and moves Up Next entries, never the playing one', () => {
    const long = playFrom(LETTERS.slice(0, 5), 1);
    expect(removeAt(long, [0, 1, 3])).toMatchObject({ items: ['b', 'c', 'e'], index: 0 });
    expect(clearUpNext(long).items).toEqual(['a', 'b']);
    expect(move(long, 4, 2).items).toEqual(['a', 'b', 'e', 'c', 'd']);
    expect(move(long, 2, 0).items).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(move(long, 1, 3)).toBe(long);
  });
});

describe('shuffle', () => {
  const q = playFrom(LETTERS, 2);

  it('shuffles only what comes after the playing song, and turning it off puts the order back', () => {
    const s = setShuffle(q, true, 7);
    expect(isShuffled(s)).toBe(true);
    expect(s.items.slice(0, 3)).toEqual(['a', 'b', 'c']);
    expect([...s.items].sort()).toEqual(LETTERS);
    expect(s.items).not.toEqual(LETTERS);
    // Move on two songs, then turn it off: the order is back, from the song playing now.
    const later = next(next(s)!)!;
    const off = setShuffle(later, false, 0);
    expect(off.items).toEqual(LETTERS);
    expect(current(off)).toBe(current(later));
  });

  it('the same seed shuffles the same way', () => {
    expect(shuffled(LETTERS, 42)).toEqual(shuffled(LETTERS, 42));
    expect(shuffled(LETTERS, 42)).not.toEqual(shuffled(LETTERS, 43));
  });

  it('Play Next and Add to Queue keep their place in both orders', () => {
    let s = setShuffle(q, true, 7);
    s = playNext(s, ['x']);
    s = addToQueue(s, ['z']);
    expect(s.items[3]).toBe('x');
    expect(s.items.at(-1)).toBe('z');
    const off = setShuffle(s, false, 0);
    expect(off.items).toEqual(['a', 'b', 'c', 'x', 'd', 'e', 'f', 'g', 'h', 'z']);
  });

  it('Shuffle on a page plays the whole list in a random order', () => {
    const s = shuffleAll(LETTERS, 3);
    expect(s.index).toBe(0);
    expect([...s.items].sort()).toEqual(LETTERS);
    expect(setShuffle(s, false, 0).items).toEqual(LETTERS);
  });

  it('playing from a list keeps shuffle on and shuffles what follows', () => {
    const on = setShuffle(q, true, 1);
    const fresh = playFrom(['p', 'q', 'r', 's'], 1, on, 5);
    expect(isShuffled(fresh)).toBe(true);
    expect(current(fresh)).toBe('q');
    expect(setShuffle(fresh, false, 0).items).toEqual(['p', 'q', 'r', 's']);
  });

  it('keeps every entry and their ranks in step through random edits', () => {
    let s: Queue = setShuffle(playFrom(LETTERS, 0), true, 9);
    const ops = [
      (x: Queue) => playNext(x, ['n']),
      (x: Queue) => addToQueue(x, ['m']),
      (x: Queue) => move(x, x.items.length - 1, x.index + 1),
      (x: Queue) => removeAt(x, [x.items.length - 1]),
      (x: Queue) => next(x) ?? x,
      (x: Queue) => setShuffle(x, !isShuffled(x), 4),
    ];
    for (let i = 0; i < 200; i++) {
      s = ops[(i * 7) % ops.length]!(s);
      expect(s.index).toBeLessThan(s.items.length);
      if (s.rank) expect(s.rank).toHaveLength(s.items.length);
    }
  });
});

describe('the saved queue', () => {
  it('reads back what it wrote, and throws away anything else', () => {
    const q = setShuffle(toggleRepeatQueue(playFrom(LETTERS, 1)), true, 2);
    const text = JSON.stringify(saveQueue('/Music', q, 12.5));
    expect(parseSavedQueue(text, '/Music')).toEqual({ format: 1, root: '/Music', queue: q, position: 12.5 });
    expect(parseSavedQueue(text, '/Other')).toBeNull();
    expect(parseSavedQueue('{', '/Music')).toBeNull();
    const bad = (queue: object) =>
      parseSavedQueue(JSON.stringify({ format: 1, root: '/M', position: 0, queue }), '/M');
    expect(bad({ items: ['a'], index: 1, repeat: 'off', rank: null })).toBeNull();
    expect(bad({ items: ['a'], index: 0, repeat: 'sometimes', rank: null })).toBeNull();
    expect(bad({ items: ['a'], index: 0, repeat: 'off', rank: [1, 2] })).toBeNull();
    expect(bad({ items: [1], index: 0, repeat: 'off', rank: null })).toBeNull();
    expect(bad({ items: ['a'], index: 0, repeat: 'off', rank: null })).not.toBeNull();
  });
});
