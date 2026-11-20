import { describe, expect, it } from 'vitest';
import { formatShortcut, matchRank, parseShortcut, type Shortcut, type ShortcutEvent } from '../src/index.ts';

const matches = (s: Shortcut, e: ShortcutEvent, mac: boolean) => matchRank(s, e, mac) > 0;

const press = (
  key: string,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {},
) => ({
  key,
  code: '',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('shortcuts', () => {
  it('reads arrow and escape keys by either name', () => {
    expect(parseShortcut('mod+arrowright')).toEqual(parseShortcut('mod+right'));
    expect(parseShortcut('escape').key).toBe('esc');
  });

  it('matches arrow keys', () => {
    expect(matches(parseShortcut('mod+right'), press('ArrowRight', { metaKey: true }), true)).toBe(true);
    expect(
      matches(parseShortcut('mod+alt+left'), press('ArrowLeft', { ctrlKey: true, altKey: true }), false),
    ).toBe(true);
  });

  it('labels arrow keys on each platform', () => {
    expect(formatShortcut(parseShortcut('mod+alt+right'), true)).toBe('⌥⌘→');
    expect(formatShortcut(parseShortcut('mod+up'), false)).toBe('Ctrl+Up');
  });
});
