import { describe, expect, it, vi } from 'vitest';
import { makeIndex, type Song } from '@playlark/core';
import { memoryIndexStore, memoryLibrary } from '@playlark/ui';
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

describe('the index and covers', () => {
  const NOW = new Date('2026-03-04T05:06:07Z');

  it('shows the saved index at once, then saves the scan for next time', async () => {
    const index = memoryIndexStore();
    const stale: Song = {
      path: 'Gone/old.mp3',
      size: 1,
      mtime: 1,
      format: 'mp3',
      codec: 'mp3',
      title: 'From Last Time',
      artist: 'A',
      album: 'B',
      albumArtist: 'A',
      compilation: false,
      duration: 1,
      sampleRate: 44100,
      channels: 2,
    };
    await index.save(makeIndex('basic', [stale], NOW));
    await index.saveCover('f'.repeat(64), { mime: 'image/png', type: 3, data: new Uint8Array([1]) });
    const { app } = await makeApp({ index, now: () => NOW });
    const library = await fixtureLibrary();
    let listed!: () => void;
    const listing = new Promise<void>((r) => (listed = r));
    const opening = app.open({ ...library, list: () => listing.then(() => library.list()) });
    await vi.waitFor(() => expect(app.songs.value.map((s) => s.title)).toEqual(['From Last Time']));
    expect(app.scanned.value).toBe(false);
    listed();
    await opening;
    expect(app.songs.value.map((s) => s.title)).not.toContain('From Last Time');
    const saved = await index.load('basic');
    expect(saved?.scannedAt).toBe(NOW.toISOString());
    expect(saved?.songs).toEqual(app.songs.value);
    // No song uses the stored cover any more.
    expect(index.covers.size).toBe(0);
  });

  it('shows the folder’s cover image for the playing song', async () => {
    const imageUrl = vi.fn((_bytes: ArrayBuffer, mime: string) => `blob:${mime}`);
    const { app, catalog } = await makeApp({ imageUrl });
    await app.open(await fixtureLibrary());
    app.cursor.value = app.songs.value.find((s) => s.title === 'Static Bloom')!.path;
    catalog.run('song.play');
    await vi.waitFor(() => expect(app.nowCover.value).toBe('blob:image/jpeg'));
    app.cursor.value = app.songs.value.find((s) => s.title === 'Morning Tide')!.path;
    catalog.run('song.play');
    await vi.waitFor(() => expect(app.player.currentSong.value?.title).toBe('Morning Tide'));
    expect(app.nowCover.value).toBeNull();
  });

  it('lists the files it couldn’t read, from the notice', async () => {
    const { app } = await makeApp();
    await app.open(memoryLibrary('broken', { 'bad.flac': new Uint8Array([1, 2, 3, 4]) }));
    const notice = app.notice.value!;
    expect(notice.text).toBe('1 file couldn’t be read.');
    notice.action!.run();
    expect(app.dialog.value).toBe('unreadable');
    expect(app.songs.value[0]?.error).toBeTruthy();
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
