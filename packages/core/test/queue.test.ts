import { describe, expect, it } from 'vitest';
import { EMPTY_QUEUE, current, next, playFrom, previous, prune } from '../src/index.ts';

describe('the play queue', () => {
  const q = playFrom(['a', 'b', 'c'], 1);

  it('plays from the chosen song and moves on in order', () => {
    expect(current(q)).toBe('b');
    expect(current(next(q)!)).toBe('c');
    expect(next(next(q)!)).toBeNull();
    expect(playFrom([], 0)).toBe(EMPTY_QUEUE);
  });

  it('restarts the song after 3 seconds, else goes back one', () => {
    expect(previous(q, 10)).toEqual({ queue: q, restart: true });
    expect(current(previous(q, 1).queue)).toBe('a');
    expect(previous(playFrom(['a'], 0), 0).restart).toBe(true);
  });

  it('drops removed songs and keeps the playing one', () => {
    expect(prune(q, (p) => p !== 'a')).toEqual({ items: ['b', 'c'], index: 0 });
    expect(prune(q, (p) => p !== 'b')).toEqual({ items: ['a', 'c'], index: 1 });
    expect(prune(q, () => false)).toBe(EMPTY_QUEUE);
  });
});
