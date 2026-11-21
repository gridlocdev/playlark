import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseStatsFile, type Song } from '@playlark/core';
import { libraryDir } from '@playlark/node-files';
import {
  choosePlayer,
  desktopDataDir,
  editFrom,
  likelyDuplicates,
  missingTags,
  parse,
  run,
  type Player,
  type RunContext,
} from '../src/index.ts';

const FIXTURES = fileURLToPath(new URL('../../../e2e/fixtures/', import.meta.url));
const MP3 = 'Northwind Quartet/Harbour Lights/01 Morning Tide.mp3';
const FLAC = 'Northwind Quartet/Harbour Lights/02 Salt Air.flac';
const UNTAGGED = 'Loose/untagged.mp3';
const top = mkdtempSync(path.join(tmpdir(), 'playlark-cli-'));
afterAll(() => rmSync(top, { recursive: true, force: true }));

let n = 0;
let music: string;
let data: string;

/** A player that makes no sound: it records what it was asked to play. */
function silentPlayer(found: readonly string[] = ['afplay', 'ffplay', 'paplay']) {
  const started: { command: string; args: readonly string[] }[] = [];
  let interrupt: (() => void) | null = null;
  const player: Player = {
    has: (c) => Promise.resolve(found.includes(c)),
    start: (command, args) => {
      started.push({ command, args });
      return { done: Promise.resolve(), stop: () => undefined };
    },
    onInterrupt: (stop) => {
      interrupt = stop;
      return () => (interrupt = null);
    },
    say: () => undefined,
  };
  return { player, started, interrupt: () => interrupt?.() };
}

async function cli(argv: string[], extra: Partial<RunContext> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    env: { PLAYLARK_USER_DATA: data, PLAYLARK_DIR: music },
    platform: 'linux',
    home: top,
    cwd: top,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    player: silentPlayer().player,
    now: () => new Date(2026, 10, 20, 12),
    ...extra,
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

async function json(argv: string[], extra: Partial<RunContext> = {}) {
  const r = await cli(['--json', ...argv], extra);
  return { code: r.code, body: JSON.parse(r.out) as Record<string, unknown> };
}

beforeEach(() => {
  const dir = path.join(top, String(n++));
  music = path.join(dir, 'Music');
  data = path.join(dir, 'data');
  cpSync(path.join(FIXTURES, 'basic'), music, { recursive: true });
});

describe('the playlark command (PRD §20)', () => {
  it('scans and counts, and saves the index and stats where the desktop app keeps them', async () => {
    const { code, body } = await json(['scan']);
    expect(code).toBe(0);
    expect(body).toEqual({ ok: true, songs: 7, albums: 4, artists: 4, unreadable: 0 });
    const indexes = readdirSync(path.join(data, 'libraries'));
    expect(indexes).toHaveLength(1);
    const dir = await libraryDir(data, music);
    const stats = parseStatsFile(readFileSync(path.join(dir, 'stats.json'), 'utf8'))!;
    expect(stats.get('Music')?.get(MP3)?.added).not.toBeNull();
  });

  it('uses the desktop app’s index for the folder it has open', async () => {
    mkdirSync(data, { recursive: true });
    writeFileSync(path.join(data, 'folder.json'), JSON.stringify({ folder: music }));
    expect((await cli(['scan'], { env: { PLAYLARK_USER_DATA: data } })).code).toBe(0);
    const dir = await libraryDir(data, music);
    expect(JSON.parse(readFileSync(path.join(dir, 'library.json'), 'utf8'))).toMatchObject({
      root: 'Music',
    });
  });

  it('says how to name a folder when there is none', async () => {
    const r = await cli(['scan'], { env: { PLAYLARK_USER_DATA: data } });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--dir/);
  });

  it('lists songs, albums and artists with filters that match words the way search does', async () => {
    const songs = (await json(['songs', '--artist', 'north'])).body['songs'] as Song[];
    expect(songs.map((s) => s.path)).toEqual([
      MP3,
      FLAC,
      'Northwind Quartet/Harbour Lights/03 Lantern Walk.m4a',
    ]);
    const albums = (await json(['albums', '--year', '2019'])).body['albums'] as { title: string }[];
    expect(albums.map((a) => a.title)).toEqual(['Small Hours']);
    const artists = (await json(['artists'])).body['artists'] as { name: string }[];
    expect(artists.map((a) => a.name)).toContain('Paper Kites Club');
    expect((await cli(['songs', '--year', 'soon'])).code).toBe(1);
  });

  it('searches artists, albums and songs', async () => {
    const { body } = await json(['search', 'harb', 'north']);
    expect((body['albums'] as { title: string }[]).map((a) => a.title)).toEqual(['Harbour Lights']);
    expect((body['songs'] as Song[]).length).toBe(3);
    expect((await cli(['search'])).code).toBe(1);
  });

  it('checks for missing tags, albums without covers, duplicates and unreadable files', async () => {
    writeFileSync(path.join(music, 'Loose/broken.mp3'), 'not music');
    cpSync(path.join(music, MP3), path.join(music, 'Loose/Morning Tide copy.mp3'));
    const { body } = await json(['check']);
    expect(body['missingTags']).toContainEqual({
      path: UNTAGGED,
      missing: ['title', 'artist', 'album', 'track number'],
    });
    expect((body['albumsWithoutCover'] as { title: string }[]).map((a) => a.title)).toContain(
      'Harbour Lights',
    );
    expect((body['likelyDuplicates'] as string[][]).map((g) => g.toSorted())).toEqual([
      ['Loose/Morning Tide copy.mp3', MP3],
    ]);
    expect((body['unreadable'] as { path: string }[]).map((u) => u.path)).toEqual(['Loose/broken.mp3']);
  });

  it('makes, shows, adds to, takes from and checks playlists', async () => {
    const made = await json(['playlist', 'create', 'Road Trip', MP3, path.join(music, UNTAGGED)]);
    expect(made).toEqual({ code: 0, body: { ok: true, path: 'Playlists/Road Trip.m3u8', entries: 2 } });
    expect((await json(['playlist', 'create', 'road trip'])).body).toMatchObject({ ok: false, exit: 2 });
    expect((await cli(['playlist', 'add', 'Road Trip', FLAC])).code).toBe(0);
    expect((await cli(['playlist', 'remove', 'road trip', '2'])).code).toBe(0);
    const shown = (await json(['playlist', 'show', 'Road Trip'])).body['entries'] as { path: string }[];
    expect(shown.map((e) => e.path)).toEqual([MP3, FLAC]);
    const file = readFileSync(path.join(music, 'Playlists/Road Trip.m3u8'), 'utf8');
    expect(file).toBe(
      '#EXTM3U\n#EXTINF:2,Northwind Quartet - Morning Tide\n../Northwind Quartet/Harbour Lights/01 Morning Tide.mp3\n' +
        '#EXTINF:2,Northwind Quartet - Salt Air\n../Northwind Quartet/Harbour Lights/02 Salt Air.flac\n',
    );
    rmSync(path.join(music, FLAC));
    const checked = (await json(['playlist', 'check'])).body['playlists'];
    expect(checked).toEqual([
      {
        path: 'Playlists/Road Trip.m3u8',
        missing: [{ position: 2, entry: '../Northwind Quartet/Harbour Lights/02 Salt Air.flac' }],
      },
    ]);
    expect((await json(['playlist', 'list'])).body['playlists']).toEqual([
      { name: 'Road Trip', path: 'Playlists/Road Trip.m3u8', entries: 2, missing: 1 },
    ]);
    expect((await cli(['playlist', 'remove', 'Road Trip', '9'])).code).toBe(1);
    expect((await cli(['playlist', 'show', 'Nope'])).code).toBe(1);
    expect((await cli(['playlist', 'add', 'Road Trip', 'not/a/song.mp3'])).code).toBe(1);
  });

  it('sets tags with the app’s writers, keeping the original in the trash', async () => {
    const r = await cli(['tags', 'set', UNTAGGED, '--title', 'First Light', '--track', '4', '--album', '']);
    expect(r).toMatchObject({ code: 0, out: `Saved ${UNTAGGED}` });
    const song = (await json(['tags', 'show', UNTAGGED])).body['song'] as Song;
    expect(song).toMatchObject({ title: 'First Light', track: 4, album: 'Unknown Album' });
    expect(statSync(path.join(data, 'trash/2026-11-20', UNTAGGED)).isFile()).toBe(true);
    expect((await cli(['tags', 'set', UNTAGGED])).code).toBe(1);
    expect((await cli(['tags', 'set', UNTAGGED, '--track', 'x'])).code).toBe(1);
    expect((await cli(['songs', '--title', 'x'])).err).toBe('--title doesn’t go with songs.');
  });

  it('gives exit 2 when a song changed between the scan and the save', async () => {
    const file = path.join(music, UNTAGGED);
    let calls = 0;
    const { body } = await json(['tags', 'set', UNTAGGED, '--title', 'Late'], {
      now: () => {
        // The second call comes after the rescan read the file: touch it before the write checks it.
        if (++calls === 2) utimesSync(file, new Date(2001, 0, 1), new Date(2001, 0, 1));
        return new Date(2026, 10, 20, 12);
      },
    });
    expect(body).toMatchObject({ ok: false, exit: 2 });
  });

  it('plays a song, a playlist or what a search finds, one after another, through the system player', async () => {
    const p = silentPlayer(['ffplay']);
    expect((await cli(['play', MP3], { player: p.player })).code).toBe(0);
    expect(p.started).toEqual([
      {
        command: 'ffplay',
        args: ['-nodisp', '-autoexit', '-loglevel', 'error', path.join(realpathSync(music), MP3)],
      },
    ]);
    await cli(['playlist', 'create', 'Two', FLAC, MP3]);
    p.started.length = 0;
    expect((await json(['play', 'two'], { player: p.player })).body).toEqual({
      ok: true,
      played: [FLAC, MP3],
      stopped: false,
    });
    p.started.length = 0;
    await cli(['play', 'harbour'], { player: p.player });
    expect(p.started).toHaveLength(3);
    expect((await cli(['play', 'zzzz'], { player: p.player })).code).toBe(1);
  });

  it('stops on Ctrl-C', async () => {
    const p = silentPlayer(['paplay']);
    const player: Player = {
      ...p.player,
      start: (c, a) => {
        const playing = p.player.start(c, a);
        p.interrupt();
        return playing;
      },
    };
    expect((await json(['play', 'harbour'], { player })).body).toEqual({
      ok: true,
      played: [],
      stopped: true,
    });
    expect(p.started).toHaveLength(1);
  });

  it('names the players it looks for when none is there', async () => {
    await expect(choosePlayer('linux', silentPlayer([]).player)).rejects.toThrow(/ffplay.*paplay/);
    expect((await choosePlayer('darwin', silentPlayer().player)).command).toBe('afplay');
  });

  it('prints usage for --help and a JSON error for a mistake', async () => {
    expect((await cli(['--help'])).out).toMatch(/^playlark \[--dir/);
    expect(await json(['--frobnicate'])).toMatchObject({ code: 1, body: { ok: false, exit: 1 } });
    expect((await cli([])).code).toBe(1);
  });
});

describe('the CLI’s helpers', () => {
  it('finds the desktop app’s data folder on each system', () => {
    expect(desktopDataDir({ env: {}, platform: 'darwin', home: '/Users/a', cwd: '/' })).toBe(
      '/Users/a/Library/Application Support/Playlark',
    );
    expect(desktopDataDir({ env: {}, platform: 'linux', home: '/home/a', cwd: '/' })).toBe(
      '/home/a/.config/Playlark',
    );
    expect(
      desktopDataDir({ env: { PLAYLARK_USER_DATA: '/x' }, platform: 'linux', home: '/h', cwd: '/' }),
    ).toBe('/x');
  });

  it('reads tag options into an edit', () => {
    expect(editFrom({ title: ' A ', 'album-artist': 'B', year: '', compilation: 'yes' })).toEqual({
      title: 'A',
      albumArtist: 'B',
      year: null,
      compilation: true,
    });
    expect(() => editFrom({ disc: '0' })).toThrow(/whole number/);
  });

  it('parses global options anywhere on the line', () => {
    expect(parse(['songs', '--json', '--dir', '/m', '--artist', 'x'])).toMatchObject({
      command: 'songs',
      json: true,
      dir: '/m',
      values: { artist: 'x' },
    });
  });

  it('flags missing tags and groups duplicates within 2 s', () => {
    const song = (p: string, duration: number, extra: Partial<Song> = {}): Song => ({
      path: p,
      size: 1,
      mtime: 1,
      format: 'mp3',
      codec: 'mp3',
      title: 'Tide',
      artist: 'Sea',
      album: 'Shore',
      albumArtist: 'Sea',
      track: 1,
      compilation: false,
      duration,
      sampleRate: 44100,
      channels: 2,
      ...extra,
    });
    expect(missingTags(song('a.mp3', 1))).toEqual([]);
    const groups = likelyDuplicates([
      song('a.mp3', 100),
      song('b.mp3', 101.5),
      song('c.mp3', 110),
      song('d.mp3', 200, { title: 'Other' }),
    ]);
    expect(groups.map((g) => g.map((s) => s.path))).toEqual([['a.mp3', 'b.mp3']]);
  });
});
