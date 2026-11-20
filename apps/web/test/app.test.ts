import { describe, expect, it, vi } from 'vitest';
import { makeIndex, type Song } from '@playlark/core';
import { memoryIndexStore, memoryLibrary } from '@playlark/ui';
import { cursorStep, only } from '../src/index.ts';
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
    app.selection.value = only(paths[2]!);
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
    app.selection.value = only(app.songs.value.find((s) => s.title === 'Static Bloom')!.path);
    catalog.run('song.play');
    await vi.waitFor(() => expect(app.nowCover.value).toBe('blob:image/jpeg'));
    app.selection.value = only(app.songs.value.find((s) => s.title === 'Morning Tide')!.path);
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

describe('browsing', () => {
  const titles = (songs: readonly Song[]) => songs.map((s) => s.title);

  it('opens albums and artists, and walks back and forward', async () => {
    const { app, catalog } = await makeApp();
    await app.open(await fixtureLibrary());
    catalog.run('view.albums');
    expect(app.library.value.albums.map((a) => a.title)).toEqual(
      expect.arrayContaining(['Harbour Lights', 'Small Hours']),
    );
    const small = app.library.value.albums.find((a) => a.title === 'Small Hours')!;
    expect(small.discs).toBe(2);
    app.navigate({ kind: 'album', key: small.key });
    expect(titles(app.rows.value)).toEqual(['Static Bloom', 'Night Bus']);
    expect(app.cursor.value).toBe(app.rows.value[0]!.path);
    catalog.run('view.back');
    expect(app.view.value.kind).toBe('albums');
    catalog.run('view.back');
    expect(app.view.value.kind).toBe('songs');
    expect(catalog.isEnabled(catalog.get('view.back')!)).toBe(false);
    catalog.run('view.forward');
    catalog.run('view.forward');
    expect(app.view.value).toEqual({ kind: 'album', key: small.key });
  });

  it('plays a folder and everything under it', async () => {
    const { app } = await makeApp();
    await app.open(await fixtureLibrary());
    app.navigate({ kind: 'folders', path: '' });
    expect(app.rows.value).toEqual([]);
    expect(app.library.value.root.folders.map((f) => f.name)).toEqual([
      'Field Recordings',
      'Loose',
      'Northwind Quartet',
      'Paper Kites Club',
    ]);
    await app.playSongs(app.folderSongs('Paper Kites Club'));
    expect(app.player.queue.value.items.map((p) => p.split('/').at(-1))).toEqual([
      '1-01 Static Bloom.ogg',
      '2-01 Night Bus.opus',
    ]);
  });

  it('plays just the selected songs when several are selected', async () => {
    const { app, catalog } = await makeApp();
    await app.open(await fixtureLibrary());
    const paths = app.rowPaths.value;
    app.selection.value = { paths: new Set([paths[1]!, paths[3]!]), cursor: paths[3]!, anchor: paths[1]! };
    catalog.run('song.play');
    await settle();
    expect(app.player.queue.value.items).toEqual([paths[1], paths[3]]);
  });

  it('Select All selects every song in the view', async () => {
    const { app, catalog } = await makeApp();
    await app.open(await fixtureLibrary());
    catalog.run('edit.selectAll');
    expect(app.selection.value.paths.size).toBe(app.songs.value.length);
  });

  it('sorts the Songs view by a column, and again to reverse it', async () => {
    const { app } = await makeApp();
    await app.open(await fixtureLibrary());
    app.sortBy('title');
    expect(titles(app.rows.value)[0]).toBe('Lantern Walk');
    app.sortBy('title');
    expect(titles(app.rows.value)[0]).toBe('untagged');
  });

  it('searches after a pause, and Escape goes back to the view before', async () => {
    const { app } = await makeApp();
    await app.open(await fixtureLibrary());
    app.navigate({ kind: 'albums' });
    app.setSearch('salt');
    expect(app.view.value.kind).toBe('albums');
    await vi.waitFor(() => expect(app.view.value).toEqual({ kind: 'search', query: 'salt' }));
    expect(titles(app.rows.value)).toEqual(['Salt Air']);
    app.setSearch('harb');
    await vi.waitFor(() => expect(app.view.value).toEqual({ kind: 'search', query: 'harb' }));
    expect(app.results.value?.albums.map((a) => a.title)).toEqual(['Harbour Lights']);
    // Typing more replaces the search rather than adding a step to go back through.
    expect(app.history.value.back.map((v) => v.kind)).toEqual(['songs', 'albums']);
    app.clearSearch();
    expect(app.view.value.kind).toBe('albums');
    expect(app.searchText.value).toBe('');
  });

  it('goes to the selected song’s album and artist, and back to the playing song', async () => {
    const { app, catalog } = await makeApp();
    await app.open(await fixtureLibrary());
    const salt = app.songs.value.find((s) => s.title === 'Salt Air')!;
    app.selection.value = only(salt.path);
    catalog.run('song.goToAlbum');
    expect(app.view.value.kind).toBe('album');
    expect(app.cursor.value).toBe(salt.path);
    catalog.run('song.play');
    await settle();
    catalog.run('song.goToArtist');
    expect(app.view.value).toEqual({ kind: 'artist', key: 'northwind quartet' });
    app.navigate({ kind: 'albums' });
    catalog.run('song.goToCurrent');
    expect(app.view.value.kind).toBe('songs');
    expect(app.cursor.value).toBe(salt.path);
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

describe('the queue', () => {
  it('Play Next and Add to Queue put songs in the queue and say so', async () => {
    const { app } = await makeApp();
    await app.open(await fixtureLibrary());
    const songs = app.songs.value;
    await app.playSongs(songs.slice(0, 3), songs[0]!.path);
    app.playNext([songs[4]!]);
    expect(app.notice.value?.text).toBe('Playing next: Static Bloom');
    app.addToQueue([songs[5]!, songs[3]!]);
    expect(app.notice.value?.text).toBe('Added 2 songs to the queue.');
    const titles = app.player.queue.value.items.map((p) => app.byPath.value.get(p)?.title);
    expect(titles).toEqual([
      'Rain on Tin',
      'Static Bloom',
      'Morning Tide',
      'Salt Air',
      'Night Bus',
      'Lantern Walk',
    ]);
  });

  it('Delete takes the song under the queue cursor out and keeps the cursor near it', async () => {
    const { app, catalog } = await makeApp();
    await app.open(await fixtureLibrary());
    const songs = app.songs.value;
    await app.playSongs(songs.slice(0, 4), songs[0]!.path);
    app.queueFocused.value = true;
    app.queueCursor.value = 2;
    await catalog.run('queue.remove');
    const titles = app.player.queue.value.items.map((p) => app.byPath.value.get(p)?.title);
    expect(titles).toEqual(['Rain on Tin', 'Morning Tide', 'Lantern Walk']);
    expect(app.queueCursor.value).toBe(2);
  });

  it('keeps the queue and puts it back paused in the next run, dropping songs that are gone', async () => {
    const index = memoryIndexStore();
    const first = await makeApp({ index });
    await first.app.open(await fixtureLibrary());
    const songs = first.app.songs.value;
    await first.app.playSongs(songs.slice(0, 3), songs[1]!.path);
    first.engine.at = 12;
    first.app.player.tick();
    await first.app.keepQueue();

    const second = await makeApp({ index });
    await second.app.open(await fixtureLibrary());
    const q = second.app.player.queue.value;
    expect(q.items).toEqual(songs.slice(0, 3).map((s) => s.path));
    expect(q.index).toBe(1);
    expect(second.app.player.state.value).toBe('paused');
    expect(second.app.player.position.value).toBe(12);

    // Salt Air is deleted before the third run.
    const full = await fixtureLibrary();
    const files: Record<string, Uint8Array> = {};
    for (const f of await full.list())
      if (f.path !== songs[2]!.path) files[f.path] = new Uint8Array(await full.bytes(f.path));
    await second.app.keepQueue();
    const third = await makeApp({ index });
    await third.app.open(memoryLibrary('basic', files));
    expect(third.app.player.queue.value.items).toEqual(songs.slice(0, 2).map((s) => s.path));
    expect(third.app.player.queue.value.index).toBe(1);
    expect(third.app.notice.value?.text).toBe('1 song in your queue is gone and was removed.');
  });
});
