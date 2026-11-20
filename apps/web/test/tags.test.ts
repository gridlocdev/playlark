import { describe, expect, it } from 'vitest';
import { memorySource, readTags } from '@playlark/core';
import { memoryLibrary, type LibrarySource } from '@playlark/ui';
import { SONG_MENU } from '../src/index.ts';
import { fixtureFiles, makeApp } from './helpers.ts';

const MP3 = 'Northwind Quartet/Harbour Lights/01 Morning Tide.mp3';
const FLAC = 'Northwind Quartet/Harbour Lights/02 Salt Air.flac';
const M4A = 'Northwind Quartet/Harbour Lights/03 Lantern Walk.m4a';
const OGG = 'Paper Kites Club/Small Hours/1-01 Static Bloom.ogg';

async function tagsApp(wrap: (s: LibrarySource) => LibrarySource = (s) => s) {
  const files = await fixtureFiles();
  const made = await makeApp();
  await made.app.open(wrap(memoryLibrary('basic', files)));
  const select = (...paths: string[]) => {
    made.app.selection.value = { paths: new Set(paths), cursor: paths[0]!, anchor: paths[0]! };
  };
  const open = async (...paths: string[]) => {
    select(...paths);
    made.catalog.run('song.info');
    // The dialog reads each file's tags.
    while (made.app.tags.loading.peek()) await new Promise((r) => setTimeout(r, 1));
  };
  const fileTags = async (path: string) => {
    const r = await readTags(memorySource(files[path]!), path);
    if (!r.ok) throw new Error(r.error);
    return r.tags;
  };
  return { ...made, files, open, fileTags };
}

describe('Song Info (§11.1)', () => {
  it('shows a song’s own tags, saves a changed title, and Undo and Redo write it back and forth', async () => {
    const { app, catalog, open, fileTags } = await tagsApp();
    expect(SONG_MENU).toContain('song.info');
    const before = await fileTags(FLAC);
    await open(FLAC);
    expect(app.dialog.value).toBe('songInfo');
    expect(app.tags.readOnly.value).toBeNull();
    expect(app.tags.fields.value!.title.value).toBe(before.title);

    app.tags.setField('title', 'Sea Salt');
    await app.tags.save();
    expect(app.dialog.value).toBeNull();
    expect(await fileTags(FLAC)).toEqual({ ...before, title: 'Sea Salt' });
    expect(app.byPath.value.get(FLAC)!.title).toBe('Sea Salt');

    expect(catalog.get('edit.undo')!.enabled!()).toBe(true);
    await app.undoStep();
    expect(app.notice.value?.text).toBe('Undo Edit Tags');
    expect((await fileTags(FLAC)).title).toBe(before.title);
    expect(app.byPath.value.get(FLAC)!.title).toBe(before.title);

    await app.undoStep(true);
    expect((await fileTags(FLAC)).title).toBe('Sea Salt');
    expect(app.byPath.value.get(FLAC)!.title).toBe('Sea Salt');
  });

  it('with several songs, shows Mixed, can’t change the title, and writes only the changed field', async () => {
    const { app, open, fileTags } = await tagsApp();
    const before = await Promise.all([MP3, FLAC, M4A].map(fileTags));
    await open(MP3, FLAC, M4A);
    const fields = app.tags.fields.value!;
    expect(fields.title.mixed).toBe(true);
    expect(app.tags.canChange('title')).toBe(false);
    expect(app.tags.canChange('track')).toBe(false);
    expect(app.tags.canChange('album')).toBe(true);

    app.tags.setField('title', 'ignored');
    app.tags.setField('genre', 'Ambient');
    await app.tags.save();
    const after = await Promise.all([MP3, FLAC, M4A].map(fileTags));
    expect(after).toEqual(before.map((t) => ({ ...t, genre: 'Ambient' })));
  });

  it('writes Ogg files alongside the others (§11.2)', async () => {
    const { app, open, fileTags } = await tagsApp();
    const before = await Promise.all([FLAC, OGG].map(fileTags));
    await open(FLAC, OGG);
    expect(app.tags.readOnly.value).toBeNull();
    app.tags.setField('album', 'Elsewhere');
    await app.tags.save();
    expect(app.dialog.value).toBeNull();
    expect(await Promise.all([FLAC, OGG].map(fileTags))).toEqual(
      before.map((t) => ({ ...t, album: 'Elsewhere' })),
    );
  });

  it('writes the files it can and lists the ones that changed', async () => {
    const { app, files, open, fileTags } = await tagsApp();
    await open(FLAC, OGG);
    files[OGG] = files[OGG]!.slice(0, -1);
    app.tags.setField('album', 'Elsewhere');
    await app.tags.save();
    expect((await fileTags(FLAC)).album).toBe('Elsewhere');
    expect(app.dialog.value).toBe('songInfo');
    expect(app.tags.errors.value).toEqual([
      '1-01 Static Bloom.ogg changed somewhere else. Close Song Info and try again.',
    ]);
    expect(app.undo.canUndo.value).toBe(true);
  });

  it('leaves a file that changed since the dialog read it (§11.3)', async () => {
    const { app, files, open } = await tagsApp();
    await open(FLAC);
    files[FLAC] = files[FLAC]!.slice(0, -1);
    app.tags.setField('title', 'x');
    await app.tags.save();
    expect(app.tags.errors.value).toEqual([
      '02 Salt Air.flac changed somewhere else. Close Song Info and try again.',
    ]);
    expect(app.undo.canUndo.value).toBe(false);
  });

  it('refuses a number that isn’t a track number, and writes nothing', async () => {
    const { app, open, fileTags } = await tagsApp();
    const before = await fileTags(FLAC);
    await open(FLAC);
    app.tags.setField('year', '19x9');
    await app.tags.save();
    expect(app.tags.errors.value).toEqual(['Year must be a whole number from 1 to 65535.']);
    expect(await fileTags(FLAC)).toEqual(before);
  });

  it('is read-only where the folder can’t be written (§11.5)', async () => {
    const { app, open } = await tagsApp(({ tags: _tags, ...rest }) => rest);
    await open(FLAC);
    expect(app.tags.readOnly.value).toBe('Edit tags in the desktop app or through the NAS server.');
    expect(app.tags.canChange('artist')).toBe(false);
  });
});
