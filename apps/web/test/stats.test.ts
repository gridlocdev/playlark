import { describe, expect, it } from 'vitest';
import { memoryIndexStore, memoryLibrary, type IndexStore } from '@playlark/ui';
import { SONG_MENU } from '../src/index.ts';
import { fixtureFiles, makeApp } from './helpers.ts';

const UNTAGGED = 'Loose/untagged.mp3';
const RAIN = 'Field Recordings/rain-on-tin.wav';
const NOW = new Date('2026-11-19T12:00:00Z');

/** The app over the fixture folder, with a stats store and a clock the test moves. */
async function statsApp(index: IndexStore = memoryIndexStore()) {
  const files = await fixtureFiles();
  let clock = 0;
  const made = await makeApp({ index, now: () => NOW, clock: () => clock });
  const source = memoryLibrary('basic', files);
  await made.app.open(source);
  /** Moves the clock on `ms`, sampling the player every 250 ms as the app does. */
  const play = (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      clock += 250;
      made.app.tick();
    }
  };
  return { ...made, index, files, source, play };
}

const select = (app: Awaited<ReturnType<typeof statsApp>>['app'], path: string) => {
  app.selection.value = { paths: new Set([path]), cursor: path, anchor: path };
};

describe('favourites (§10.2)', () => {
  it('Favourite toggles the selection, is an undo step, and is kept for the next run', async () => {
    const { app, catalog, index } = await statsApp();
    expect(SONG_MENU).toContain('song.favourite');
    select(app, UNTAGGED);
    catalog.run('song.favourite');
    expect(app.stats.get(UNTAGGED).favourite).toBe(true);
    expect(catalog.get('song.favourite')!.checked!()).toBe(true);
    app.navigate({ kind: 'favourites' });
    expect(app.rows.value.map((s) => s.path)).toEqual([UNTAGGED]);

    await app.undoStep();
    expect(app.notice.value?.text).toBe('Undo Favourite');
    expect(app.stats.get(UNTAGGED).favourite).toBe(false);
    expect(app.rows.value).toEqual([]);
    await app.undoStep(true);
    expect(app.stats.get(UNTAGGED).favourite).toBe(true);

    await app.stats.flush();
    const next = await statsApp(index);
    expect(next.app.stats.get(UNTAGGED).favourite).toBe(true);
  });

  it('with several selected, turns all on when any is off, then all off', async () => {
    const { app, catalog } = await statsApp();
    app.stats.toggleFavourite([UNTAGGED]);
    app.selection.value = { paths: new Set([UNTAGGED, RAIN]), cursor: RAIN, anchor: UNTAGGED };
    catalog.run('song.favourite');
    expect([UNTAGGED, RAIN].map((p) => app.stats.get(p).favourite)).toEqual([true, true]);
    catalog.run('song.favourite');
    expect([UNTAGGED, RAIN].map((p) => app.stats.get(p).favourite)).toEqual([false, false]);
  });

  it('with nothing selected, Favourite acts on the song playing', async () => {
    const { app, catalog } = await statsApp();
    app.navigate({ kind: 'favourites' });
    expect(catalog.get('song.favourite')!.enabled!()).toBe(false);
    await app.player.playFrom([RAIN], 0);
    catalog.run('song.favourite');
    expect(app.stats.get(RAIN).favourite).toBe(true);
  });
});

describe('play counts (§10.2)', () => {
  it('counts a song once it has played half its length, once per start', async () => {
    const { app, play } = await statsApp();
    await app.player.playFrom([UNTAGGED, RAIN], 0);
    // The fake engine makes every song 60 s long, so a play counts after 30 s.
    play(29_000);
    expect(app.stats.get(UNTAGGED).plays).toBe(0);
    play(1_500);
    expect(app.stats.get(UNTAGGED)).toMatchObject({ plays: 1, lastPlayed: NOW.getTime() });
    play(20_000);
    expect(app.stats.get(UNTAGGED).plays).toBe(1);
    await app.player.previous();
    await app.player.jumpTo(0);
    play(31_000);
    expect(app.stats.get(UNTAGGED).plays).toBe(2);
    app.navigate({ kind: 'mostPlayed' });
    expect(app.rows.value.map((s) => s.path)).toEqual([UNTAGGED]);
  });

  it('adds nothing for a seek or while paused', async () => {
    const { app, play } = await statsApp();
    await app.player.playFrom([UNTAGGED], 0);
    play(1_000);
    await app.player.seek(55);
    play(1_000);
    expect(app.stats.get(UNTAGGED).plays).toBe(0);
    await app.player.toggle();
    play(60_000);
    expect(app.stats.get(UNTAGGED).plays).toBe(0);
    await app.player.toggle();
    play(29_000);
    expect(app.stats.get(UNTAGGED).plays).toBe(1);
  });
});

describe('keeping the stats (§10.1)', () => {
  it('writes only when something changed, and says once when a save fails', async () => {
    const store = memoryIndexStore();
    let saves = 0;
    let fail = false;
    const counting: IndexStore = {
      ...store,
      saveStats: (root, s) => {
        saves++;
        return fail ? Promise.reject(new Error('Disk full')) : store.saveStats(root, s);
      },
    };
    const { app } = await statsApp(counting);
    // The first scan dated every song; after that, nothing more to write.
    await app.stats.flush();
    expect(saves).toBe(1);
    await app.stats.flush();
    expect(saves).toBe(1);
    app.stats.toggleFavourite([RAIN]);
    fail = true;
    await app.stats.flush();
    expect(app.notice.value?.text).toBe('Couldn’t save favourites and play counts: Disk full');
    app.dismissNotice();
    await app.stats.flush();
    expect(app.notice.value).toBeNull();
    fail = false;
    await app.stats.flush();
    expect((await store.loadStats('basic')).get(RAIN)?.favourite).toBe(true);
    const done = saves;
    await app.stats.flush();
    expect(saves).toBe(done);
  });

  it('a stats file it can’t read is never written over', async () => {
    const store = memoryIndexStore();
    let saves = 0;
    const broken: IndexStore = {
      ...store,
      loadStats: () => Promise.reject(new Error('The file can’t be read.')),
      saveStats: () => {
        saves++;
        return Promise.resolve();
      },
    };
    const { app } = await statsApp(broken);
    expect(app.notice.value?.text).toBe('Favourites and play counts won’t be kept: The file can’t be read.');
    app.stats.toggleFavourite([RAIN]);
    await app.stats.flush();
    expect(saves).toBe(0);
  });

  it('a song moved within the folder keeps its stats; new songs show in Recently Added', async () => {
    const { app, files } = await statsApp();
    app.stats.toggleFavourite([UNTAGGED]);
    app.stats.played(UNTAGGED);
    // The first scan dated the fixture songs by their files (time 0), long before the last 90 days.
    app.navigate({ kind: 'recent' });
    expect(app.rows.value).toEqual([]);

    files['Moved/untagged.mp3'] = files[UNTAGGED]!;
    delete files[UNTAGGED];
    files['New/rain copy.wav'] = files[RAIN]!;
    await app.rescan();
    expect(app.stats.get('Moved/untagged.mp3')).toMatchObject({ favourite: true, plays: 1 });
    expect(app.stats.get(UNTAGGED).favourite).toBe(false);
    expect(app.rows.value.map((s) => s.path)).toEqual(['New/rain copy.wav']);
    expect(app.stats.get('New/rain copy.wav').added).toBe(NOW.getTime());
  });
});
