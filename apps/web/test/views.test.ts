import { describe, expect, it } from 'vitest';
import {
  NO_SELECTION,
  all,
  back,
  click,
  forward,
  go,
  keep,
  only,
  replace,
  selectedRows,
  startHistory,
  step,
} from '../src/index.ts';

describe('back and forward', () => {
  it('walks the views opened before, and a new view drops what was ahead', () => {
    let h = startHistory();
    h = go(h, { kind: 'albums' });
    h = go(h, { kind: 'album', key: 'x' });
    h = go(h, { kind: 'album', key: 'x' });
    expect(h.back).toHaveLength(2);
    h = back(back(h));
    expect(h.current).toEqual({ kind: 'songs' });
    expect(back(h)).toBe(h);
    h = forward(h);
    expect(h.current).toEqual({ kind: 'albums' });
    h = go(h, { kind: 'artists' });
    expect(h.forward).toEqual([]);
    expect(replace(h, { kind: 'search', query: 'a' }).back).toBe(h.back);
  });
});

describe('selection', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'];

  it('clicks, Shift-clicks from the anchor and ⌘-clicks to toggle', () => {
    let s = click(NO_SELECTION, rows, 'b');
    s = click(s, rows, 'd', 'extend');
    expect([...s.paths]).toEqual(['b', 'c', 'd']);
    s = click(s, rows, 'a', 'extend');
    expect([...s.paths]).toEqual(['a', 'b']);
    s = click(s, rows, 'e', 'toggle');
    s = click(s, rows, 'a', 'toggle');
    expect(selectedRows(s, rows)).toEqual(['b', 'e']);
  });

  it('moves with the keys, and Shift extends', () => {
    let s = step(only('b'), rows, 'ArrowDown', true)!;
    s = step(s, rows, 'ArrowDown', true)!;
    expect(selectedRows(s, rows)).toEqual(['b', 'c', 'd']);
    expect(step(s, rows, 'Home', false)).toEqual(only('a'));
    expect(step(s, rows, 'x', false)).toBeUndefined();
    expect(selectedRows(all(rows), rows)).toEqual(rows);
  });

  it('drops rows that go, and moves the cursor to the next row', () => {
    const s = click(only('b'), rows, 'c', 'extend');
    const after = keep(s, rows, ['a', 'b', 'd', 'e']);
    expect(after.cursor).toBe('d');
    expect([...after.paths]).toEqual(['b']);
    expect(keep(only('e'), rows, ['a', 'b']).cursor).toBe('b');
    expect(keep(only('a'), rows, rows)).toEqual(only('a'));
  });
});
