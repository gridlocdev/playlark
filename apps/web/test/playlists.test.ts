import { describe, expect, it } from 'vitest';
import { memoryLibrary, type LibrarySource, type PlaylistWriter } from '@playlark/ui';
import { MISSING, READ_ONLY, UNDO_LIMIT, UndoStack, playlistMoved } from '../src/index.ts';
import { fixtureFiles, makeApp } from './helpers.ts';

const MIX = 'Playlists/Mix.m3u8';
const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);
const encode = (s: string) => new TextEncoder().encode(s);

/** The app over the fixture folder with one playlist, `Playlists/Mix.m3u8`, holding `lines`. */
async function withPlaylist(lines: readonly string[], change?: (s: LibrarySource) => LibrarySource) {
  const files = await fixtureFiles();
  files[MIX] = encode(['#EXTM3U', ...lines, ''].join('\n'));
  const made = await makeApp();
  const source = memoryLibrary('basic', files);
  await made.app.open(change ? change(source) : source);
  const titles = () => made.app.rows.value.map((s) => s.title);
  const open = async (path = MIX) => {
    made.app.navigate({ kind: 'playlist', path });
    await made.app.playlists.load(path);
  };
  return { ...made, files, titles, open };
}

describe('playlists', () => {
  it('lists the folder’s playlists and shows a missing entry greyed, skipping it when played', async () => {
    const { app, titles, open } = await withPlaylist([
      '../Loose/untagged.mp3',
      '../Gone/away.mp3',
      '../Field Recordings/rain-on-tin.wav',
    ]);
    expect(app.playlists.list.value).toEqual([{ path: MIX, name: 'Mix' }]);
    await open();
    expect(titles()).toEqual(['untagged', 'Missing: Gone/away.mp3', 'Rain on Tin']);
    expect(app.rows.value[1]!.error).toBe(MISSING);
    await app.playSongs(app.rows.value);
    expect(app.player.queue.value.items).toEqual(['Loose/untagged.mp3', 'Field Recordings/rain-on-tin.wav']);
  });

  it('New Playlist makes Playlists/New Playlist.m3u8 with the songs, its name field showing; Undo deletes it', async () => {
    const { app, files } = await withPlaylist([]);
    const path = await app.playlists.create(['Loose/untagged.mp3']);
    expect(path).toBe('Playlists/New Playlist.m3u8');
    expect(text(files[path!])).toContain('../Loose/untagged.mp3');
    expect(app.playlists.renaming.value).toBe(path);
    expect(app.playlists.list.value.map((p) => p.name)).toEqual(['Mix', 'New Playlist']);
    await app.undoStep();
    expect(files[path!]).toBeUndefined();
    expect(app.notice.value?.text).toBe('Undo New Playlist');
    await app.undoStep(true);
    expect(text(files[path!])).toContain('../Loose/untagged.mp3');
  });

  it('adds, removes and moves entries, saving each at once, and Undo puts each back', async () => {
    const { app, files, titles, open } = await withPlaylist(['../Loose/untagged.mp3']);
    await open();
    await app.playlists.add(MIX, ['Field Recordings/rain-on-tin.wav', 'Loose/untagged.mp3']);
    expect(app.notice.value?.text).toBe('Added 2 songs to Mix.');
    expect(titles()).toEqual(['untagged', 'Rain on Tin', 'untagged']);
    await app.playlists.settled();
    expect(
      text(files[MIX])
        ?.split('\n')
        .filter((l) => !l.startsWith('#') && l),
    ).toEqual(['../Loose/untagged.mp3', '../Field Recordings/rain-on-tin.wav', '../Loose/untagged.mp3']);
    await app.playlists.move(MIX, [1], 0);
    expect(titles()).toEqual(['Rain on Tin', 'untagged', 'untagged']);
    await app.playlists.remove(MIX, [1, 2]);
    expect(titles()).toEqual(['Rain on Tin']);
    await app.undoStep();
    await app.undoStep();
    await app.undoStep();
    await app.playlists.settled();
    expect(titles()).toEqual(['untagged']);
    expect(text(files[MIX])).toBe('#EXTM3U\n#EXTINF:2,Unknown Artist - untagged\n../Loose/untagged.mp3\n');
  });

  it('an edit that changes nothing records nothing', async () => {
    const { app, open } = await withPlaylist(['../Loose/untagged.mp3']);
    await open();
    await app.playlists.move(MIX, [0], 0);
    expect(app.undo.canUndo.value).toBe(false);
  });

  it('Delete in a playlist takes the selected entries out', async () => {
    const { app, catalog, titles, open } = await withPlaylist([
      '../Loose/untagged.mp3',
      '../Field Recordings/rain-on-tin.wav',
    ]);
    await open();
    expect(app.cursor.value).toBe(app.rowKeys.value[0]);
    await catalog.run('playlist.removeEntries');
    expect(titles()).toEqual(['Rain on Tin']);
  });

  it('renames the file, the view follows, and Undo renames it back', async () => {
    const { app, files, open } = await withPlaylist(['../Loose/untagged.mp3']);
    await open();
    await app.playlists.rename(MIX, 'Road Trip');
    const to = 'Playlists/Road Trip.m3u8';
    expect(files[MIX]).toBeUndefined();
    expect(files[to]).toBeDefined();
    expect(app.view.value).toEqual({ kind: 'playlist', path: to });
    await app.undoStep();
    expect(files[MIX]).toBeDefined();
    expect(app.view.value).toEqual({ kind: 'playlist', path: MIX });
  });

  it('Delete Playlist moves it away with Undo, which puts the same bytes back', async () => {
    const { app, files, open } = await withPlaylist(['../Loose/untagged.mp3', '#a note kept as it was']);
    const before = text(files[MIX]);
    await open();
    await app.playlists.delete(MIX);
    expect(files[MIX]).toBeUndefined();
    expect(app.view.value.kind).toBe('songs');
    expect(app.notice.value?.text).toBe('Deleted Mix.');
    app.notice.value?.action?.run();
    await app.playlists.settled();
    await expect.poll(() => text(files[MIX])).toBe(before);
    expect(app.playlists.list.value.map((p) => p.name)).toEqual(['Mix']);
  });

  it('a save that finds the file changed elsewhere asks first; Keep Mine writes over it', async () => {
    const { app, files, open } = await withPlaylist(['../Loose/untagged.mp3']);
    await open();
    files[MIX] = encode('#EXTM3U\n../Field Recordings/rain-on-tin.wav\n');
    await app.playlists.add(MIX, ['Loose/untagged.mp3']);
    await app.playlists.settled();
    expect(app.playlists.conflict.value).toBe(MIX);
    expect(app.blocked()).toBe(true);
    expect(text(files[MIX])).toContain('rain-on-tin');
    await app.playlists.keepMine();
    expect(app.playlists.conflict.value).toBe(null);
    expect(text(files[MIX])).not.toContain('rain-on-tin');
    expect(text(files[MIX])?.match(/\.\.\/Loose\/untagged/g)).toHaveLength(2);
  });

  it('Use Theirs takes the file as it is now, and Undo brings mine back', async () => {
    const { app, files, titles, open } = await withPlaylist(['../Loose/untagged.mp3']);
    await open();
    files[MIX] = encode('#EXTM3U\n../Field Recordings/rain-on-tin.wav\n');
    await app.playlists.add(MIX, ['Loose/untagged.mp3']);
    await app.playlists.settled();
    await app.playlists.useTheirs();
    expect(titles()).toEqual(['Rain on Tin']);
    await app.undoStep();
    await app.playlists.settled();
    expect(titles()).toEqual(['untagged', 'untagged']);
    expect(text(files[MIX])?.match(/\.\.\/Loose\/untagged/g)).toHaveLength(2);
  });

  it('picks up a change made elsewhere as one undo step, and a playlist deleted elsewhere', async () => {
    const { app, files, titles, open } = await withPlaylist(['../Loose/untagged.mp3']);
    await open();
    await app.playlists.checkOutside();
    expect(app.undo.canUndo.value).toBe(false);
    files[MIX] = encode('#EXTM3U\n../Field Recordings/rain-on-tin.wav\n');
    await app.playlists.checkOutside();
    expect(titles()).toEqual(['Rain on Tin']);
    expect(app.notice.value?.text).toBe('Updated Mix with changes made elsewhere.');
    delete files[MIX];
    await app.playlists.checkOutside();
    expect(app.playlists.list.value).toEqual([]);
    expect(app.notice.value?.text).toBe('Mix was deleted somewhere else.');
  });

  it('retries a failed save twice, then says so with Try Again', async () => {
    let failures = 3;
    const flaky = (s: LibrarySource): LibrarySource => {
      const w = s.playlists!;
      const playlists: PlaylistWriter = {
        ...w,
        write: (...a) =>
          failures-- > 0
            ? Promise.resolve({ ok: false, code: 'failed', message: 'disk busy' })
            : w.write(...a),
      };
      return { ...s, playlists };
    };
    const { app, files, open } = await withPlaylist(['../Loose/untagged.mp3'], flaky);
    await open();
    await app.playlists.add(MIX, ['Loose/untagged.mp3']);
    await app.playlists.settled();
    expect(app.notice.value?.text).toBe('Couldn’t save Mix.');
    app.notice.value?.action?.run();
    await app.playlists.settled();
    expect(text(files[MIX])?.match(/\.\.\/Loose\/untagged/g)).toHaveLength(2);
  });

  it('becomes editable once a folder that can be written is open', async () => {
    const { app } = await makeApp();
    expect(app.playlists.editable.value).toBe(false);
    await app.open(memoryLibrary('basic', await fixtureFiles()));
    expect(app.playlists.editable.value).toBe(true);
  });

  it('can’t be edited where the folder can’t be written (a folder opened in the browser)', async () => {
    const { app, catalog } = await withPlaylist([], (s) => ({ ...s, playlists: undefined }));
    expect(app.playlists.editable.value).toBe(false);
    expect(catalog.isEnabled(catalog.get('playlist.new')!)).toBe(false);
    expect(await app.playlists.create([])).toBe(null);
    expect(app.notice.value?.text).toBe(READ_ONLY);
  });
});

describe('views follow a playlist', () => {
  it('to its new name, or out of the history when deleted', () => {
    const a = { kind: 'playlist', path: 'a.m3u8' } as const;
    const h = { back: [{ kind: 'songs' } as const, a], current: a, forward: [] };
    expect(playlistMoved(h, 'a.m3u8', 'b.m3u8').current).toEqual({ kind: 'playlist', path: 'b.m3u8' });
    const gone = playlistMoved(h, 'a.m3u8', null);
    expect(gone.current).toEqual({ kind: 'songs' });
    expect(gone.back).toEqual([{ kind: 'songs' }]);
    expect(playlistMoved(h, 'c.m3u8', null)).toBe(h);
  });
});

describe('undo', () => {
  it('undoes and redoes in order, a new step drops Redo, and keeps the last UNDO_LIMIT', async () => {
    const stack = new UndoStack();
    const log: string[] = [];
    const step = (n: number) => ({
      label: `step ${n}`,
      undo: () => void log.push(`undo ${n}`),
      redo: () => void log.push(`redo ${n}`),
    });
    for (let i = 0; i < UNDO_LIMIT + 5; i++) stack.push(step(i));
    expect(await stack.undo()).toBe(`step ${UNDO_LIMIT + 4}`);
    void stack.undo();
    await stack.redo();
    expect(log).toEqual([`undo ${UNDO_LIMIT + 4}`, `undo ${UNDO_LIMIT + 3}`, `redo ${UNDO_LIMIT + 3}`]);
    stack.push(step(-1));
    expect(stack.canRedo.value).toBe(false);
    let undone = 0;
    while (await stack.undo()) undone++;
    expect(undone).toBe(UNDO_LIMIT);
  });
});
