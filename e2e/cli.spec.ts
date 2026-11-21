// The playlark command, run as a real process on a copy of the fixtures with a throwaway data folder.
// It never plays sound: `play` runs with no player on PATH and must say which ones it looks for.
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ROOT } from './server.ts';

const BIN = path.join(ROOT, 'apps/cli/bin/playlark.mjs');
const SONG = 'Northwind Quartet/Harbour Lights/01 Morning Tide.mp3';

interface Ran {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

function playlark(args: string[], env: NodeJS.ProcessEnv): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env, cwd: ROOT }, (error, out, err) => {
      resolve({ code: error ? Number(error.code ?? 1) : 0, out, err });
    });
  });
}

test.describe('The command line', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  test.beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'playlark-cli-e2e-'));
    cpSync(path.join(ROOT, 'e2e/fixtures/basic'), path.join(dir, 'Music'), { recursive: true });
    env = {
      PATH: path.dirname(process.execPath),
      PLAYLARK_DIR: path.join(dir, 'Music'),
      PLAYLARK_USER_DATA: path.join(dir, 'data'),
    };
  });
  test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('scans, searches, makes a playlist and edits tags', async () => {
    const scan = await playlark(['--json', 'scan'], env);
    expect(scan.code).toBe(0);
    expect(JSON.parse(scan.out)).toEqual({ ok: true, songs: 7, albums: 4, artists: 4, unreadable: 0 });

    const found = await playlark(['search', 'salt'], env);
    expect(found.out).toContain('Salt Air');

    expect((await playlark(['playlist', 'create', 'Mix', SONG], env)).code).toBe(0);
    expect(readFileSync(path.join(dir, 'Music/Playlists/Mix.m3u8'), 'utf8')).toContain(
      '../Northwind Quartet/Harbour Lights/01 Morning Tide.mp3',
    );
    const again = await playlark(['--json', 'playlist', 'create', 'mix'], env);
    expect(again.code).toBe(2);
    expect(JSON.parse(again.out)).toEqual({ ok: false, error: '“mix” already exists.', exit: 2 });

    expect((await playlark(['tags', 'set', SONG, '--genre', 'Ambient'], env)).code).toBe(0);
    const shown = JSON.parse((await playlark(['--json', 'tags', 'show', SONG], env)).out) as {
      song: { genre: string };
    };
    expect(shown.song.genre).toBe('Ambient');
  });

  test('names the players it looks for and exits 1 when there is none', async () => {
    const played = await playlark(['play', 'harbour'], env);
    expect(played.code).toBe(1);
    expect(played.err).toMatch(/ffplay|afplay/);
  });
});
