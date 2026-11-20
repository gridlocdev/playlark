import { describe, expect, it, vi } from 'vitest';
import { cursorStep } from '../src/index.ts';
import { fixtureLibrary, makeApp } from './helpers.ts';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the app', () => {
  it('reads the folder and puts the cursor on the first song', async () => {
    const { app } = await makeApp();
    await app.open(await fixtureLibrary());
    expect(app.songs.value.map((s) => s.title)).toEqual([
      'Rain on Tin',
      'Morning Tide',
      'Salt Air',
      'Lantern Walk',
      'Static Bloom',
      'Night Bus',
      'untagged',
    ]);
    expect(app.cursor.value).toBe(app.songs.value[0]!.path);
    expect(app.scanned.value).toBe(true);
  });

  it('plays the list from the chosen song and moves on through the queue', async () => {
    const { app, catalog, engine } = await makeApp();
    await app.open(await fixtureLibrary());
    const paths = app.songs.value.map((s) => s.path);
    app.cursor.value = paths[2]!;
    catalog.run('song.play');
    await settle();
    expect(app.player.currentSong.value?.title).toBe('Salt Air');
    expect(app.player.queue.value.items).toEqual(paths);
    catalog.run('controls.next');
    await settle();
    expect(app.player.currentSong.value?.title).toBe('Lantern Walk');
    engine.onEnded?.();
    await settle();
    expect(app.player.currentSong.value?.title).toBe('Static Bloom');
  });

  it('Play/Pause with nothing playing plays from the cursor, then pauses', async () => {
    const { app, catalog } = await makeApp();
    await app.open(await fixtureLibrary());
    catalog.run('controls.playPause');
    await settle();
    expect(app.player.state.value).toBe('playing');
    expect(app.player.currentSong.value?.title).toBe('Rain on Tin');
    catalog.run('controls.playPause');
    await settle();
    expect(app.player.state.value).toBe('paused');
  });

  it('opening another folder stops playback', async () => {
    const { app, catalog } = await makeApp();
    await app.open(await fixtureLibrary());
    catalog.run('controls.playPause');
    await settle();
    catalog.run('file.openFolder');
    await vi.waitFor(() => expect(app.player.state.value).toBe('stopped'));
  });

  it('only the dialog commands run while a dialog is open', async () => {
    const { app, catalog } = await makeApp();
    await app.open(await fixtureLibrary());
    catalog.run('help.shortcuts');
    expect(app.dialog.value).toBe('shortcuts');
    expect(catalog.run('controls.playPause')).toBe(false);
    catalog.run('help.shortcuts');
    expect(app.dialog.value).toBeNull();
  });
});

describe('moving through the song list', () => {
  it('steps, pages and stops at the ends', () => {
    expect(cursorStep('ArrowDown', 0, 3)).toBe(1);
    expect(cursorStep('ArrowDown', 2, 3)).toBe(2);
    expect(cursorStep('ArrowUp', -1, 3)).toBe(0);
    expect(cursorStep('PageDown', 0, 40)).toBe(15);
    expect(cursorStep('End', 0, 40)).toBe(39);
    expect(cursorStep('Home', 30, 40)).toBe(0);
    expect(cursorStep('a', 0, 3)).toBeUndefined();
    expect(cursorStep('ArrowDown', -1, 0)).toBeUndefined();
  });
});
