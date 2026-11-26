import { describe, expect, it } from 'vitest';
import { RovingFocus, rovingStep, type RovingKey } from '../src/index.ts';

const press = (key: string, more: Partial<RovingKey> = {}) => {
  const e = {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    prevented: false,
    preventDefault() {
      e.prevented = true;
    },
    ...more,
  };
  return e;
};

describe('Keyboard focus', () => {
  describe('rovingStep', () => {
    it('moves by one across a row and by a row up and down, and stops at the ends', () => {
      expect(rovingStep('ArrowRight', 0, 10, 4)).toBe(1);
      expect(rovingStep('ArrowLeft', 0, 10, 4)).toBe(0);
      expect(rovingStep('ArrowDown', 1, 10, 4)).toBe(5);
      expect(rovingStep('ArrowDown', 8, 10, 4)).toBe(9);
      expect(rovingStep('ArrowUp', 5, 10, 4)).toBe(1);
      expect(rovingStep('Home', 7, 10, 4)).toBe(0);
      expect(rovingStep('End', 0, 10, 4)).toBe(9);
    });

    it('leaves ← and → alone in a one-column list, and every key in an empty one', () => {
      expect(rovingStep('ArrowRight', 0, 10)).toBeUndefined();
      expect(rovingStep('ArrowDown', 0, 10)).toBe(1);
      expect(rovingStep('ArrowDown', 0, 0)).toBeUndefined();
      expect(rovingStep('a', 0, 10)).toBeUndefined();
    });
  });

  describe('RovingFocus', () => {
    it('makes only the current item a Tab stop, kept inside the list when it shrinks', () => {
      const f = new RovingFocus();
      f.index.value = 7;
      expect([0, 1, 2].map((i) => f.tabIndex(i, 3))).toEqual([-1, -1, 0]);
      expect(f.tabIndex(7, 10)).toBe(0);
    });

    it('moves on a key and gives the new item DOM focus when it is drawn, once', () => {
      const f = new RovingFocus();
      const focused: number[] = [];
      const item = (i: number) => ({ focus: () => focused.push(i) });
      const e = press('ArrowDown');
      expect(f.keyDown(e, 5)).toBe(true);
      expect(e.prevented).toBe(true);
      expect(f.index.value).toBe(1);
      // The list redraws: each item's ref runs; only the new current one takes focus, and only this time.
      for (let i = 0; i < 5; i++) f.ref(i)(item(i));
      for (let i = 0; i < 5; i++) f.ref(i)(item(i));
      expect(focused).toEqual([1]);
    });

    it('follows DOM focus from a click or Tab, without pulling focus itself', () => {
      const f = new RovingFocus();
      const focused: number[] = [];
      f.focused(3);
      expect(f.index.value).toBe(3);
      f.ref(3)({ focus: () => focused.push(3) });
      expect(focused).toEqual([]);
    });

    it('leaves keys with a modifier, and keys it does not use, to the app', () => {
      const f = new RovingFocus();
      const e = press('ArrowDown', { metaKey: true });
      expect(f.keyDown(e, 5)).toBe(false);
      expect(f.keyDown(press('ArrowDown', { shiftKey: true }), 5)).toBe(false);
      expect(f.keyDown(press('Enter'), 5)).toBe(false);
      expect(e.prevented).toBe(false);
      expect(f.index.value).toBe(0);
    });
  });
});
