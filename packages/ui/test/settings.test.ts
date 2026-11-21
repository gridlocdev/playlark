import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, fileSettings, parseSettings } from '../src/index.ts';

describe('settings (PRD §19)', () => {
  it('takes each good field and the default for each bad one', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(
      parseSettings({
        appearance: 'dark',
        rescanOnStart: false,
        crossfade: 99,
        replayGain: 'track',
        volume: 0.5,
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      appearance: 'dark',
      rescanOnStart: false,
      replayGain: 'track',
      volume: 0.5,
    });
    expect(parseSettings({ appearance: 'blue', rescanOnStart: 'yes' })).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps a file’s settings in memory and writes the whole file on each save', async () => {
    const written: string[] = [];
    const store = fileSettings(
      '{"appearance":"light"}',
      async (t) => {
        written.push(t);
      },
      () => {},
    );
    expect(store.load().appearance).toBe('light');
    expect(store.save({ ...store.load(), crossfade: 4 })).toBe(true);
    expect(store.load().crossfade).toBe(4);
    await Promise.resolve();
    expect(JSON.parse(written[0]!)).toMatchObject({ appearance: 'light', crossfade: 4 });
  });

  it('starts from the defaults when the file is damaged, and reports a failed write', async () => {
    const failures: unknown[] = [];
    const store = fileSettings(
      '{oops',
      () => Promise.reject(new Error('disk full')),
      (e) => failures.push(e),
    );
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    store.save(DEFAULT_SETTINGS);
    await new Promise((r) => setTimeout(r, 0));
    expect(failures).toHaveLength(1);
  });
});
