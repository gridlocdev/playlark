/**
 * `play <song | playlist name | search words>` (PRD §20): the songs one after another through the system's player,
 * not gapless. Ctrl-C stops the song playing and the rest.
 */
import { spawn } from 'node:child_process';
import { access, constants, readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Song, parsePlaylist, prepareSearch, search } from '@playlark/core';
import { resolveInside } from '@playlark/node-files';
import { type Output, songLine } from './browse.ts';
import { CliError } from './errors.ts';
import type { Where } from './folder.ts';
import type { Loaded } from './library.ts';
import { folderPath, playlistsNamed } from './paths.ts';

/** A program that plays one file and exits when it's done. */
export interface PlayerCommand {
  readonly command: string;
  readonly args: (file: string) => string[];
}

/** One song playing: `done` settles when it ends or is stopped. */
export interface Playing {
  readonly done: Promise<void>;
  stop(): void;
}

export interface Player {
  /** Whether `command` is on PATH. */
  has(command: string): Promise<boolean>;
  start(command: string, args: readonly string[]): Playing;
  /** Calls `stop` once on Ctrl-C, until the returned function is called. */
  onInterrupt(stop: () => void): () => void;
  say(line: string): void;
}

const PLAYERS: readonly PlayerCommand[] = [
  { command: 'ffplay', args: (f) => ['-nodisp', '-autoexit', '-loglevel', 'error', f] },
  { command: 'paplay', args: (f) => [f] },
];
const AFPLAY: PlayerCommand = { command: 'afplay', args: (f) => [f] };

/** afplay on macOS, else ffplay or paplay when on PATH. */
export async function choosePlayer(platform: NodeJS.Platform, player: Player): Promise<PlayerCommand> {
  for (const p of platform === 'darwin' ? [AFPLAY, ...PLAYERS] : PLAYERS)
    if (await player.has(p.command)) return p;
  throw new CliError(
    platform === 'darwin'
      ? 'Couldn’t find afplay, ffplay or paplay to play through.'
      : 'Couldn’t find ffplay (from ffmpeg) or paplay (from PulseAudio) to play through. Install one of them.',
  );
}

/** The songs `words` names: a song, else a playlist's songs in order, else what a search finds. */
export async function songsToPlay(
  words: readonly string[],
  where: Where,
  cwd: string,
  loaded: Loaded,
): Promise<Song[]> {
  const text = words.join(' ');
  if (text.trim() === '') throw new CliError('play needs a song, a playlist name or words to search for.');
  const at = folderPath(text, where, cwd);
  const song = at === null ? undefined : loaded.songByPath.get(at);
  if (song) return [song];
  const lists = playlistsNamed(text, where, cwd, loaded);
  if (lists.length === 1) {
    const rel = lists[0]!;
    const bytes = new Uint8Array(await readFile(await resolveInside(where.folder, rel)));
    const file = parsePlaylist(bytes, rel, where.folder, (p) => loaded.songByPath.has(p));
    return file.entries.flatMap((e) => {
      const s = e.path === null ? undefined : loaded.songByPath.get(e.path);
      return s && !s.error ? [s] : [];
    });
  }
  const found = search(prepareSearch(loaded.library), text).songs.filter((s) => !s.error);
  if (found.length === 0) throw new CliError(`Nothing to play for “${text}”.`);
  return found;
}

export async function play(
  songs: readonly Song[],
  where: Where,
  platform: NodeJS.Platform,
  player: Player,
): Promise<Output> {
  if (songs.length === 0) throw new CliError('There is nothing in it to play.');
  const program = await choosePlayer(platform, player);
  let stopped = false;
  let playing: Playing | null = null;
  const release = player.onInterrupt(() => {
    stopped = true;
    playing?.stop();
  });
  const played: string[] = [];
  try {
    for (const [i, s] of songs.entries()) {
      if (stopped) break;
      player.say(`${i + 1} of ${songs.length}: ${songLine(s)}`);
      playing = player.start(program.command, program.args(await resolveInside(where.folder, s.path)));
      await playing.done;
      if (!stopped) played.push(s.path);
    }
  } finally {
    release();
  }
  return {
    lines: [stopped ? 'Stopped.' : `Played ${played.length} song${played.length === 1 ? '' : 's'}.`],
    json: { played, stopped },
  };
}

/** The real thing: child processes on PATH, SIGINT for Ctrl-C. */
export function systemPlayer(env: NodeJS.ProcessEnv, say: (line: string) => void): Player {
  return {
    has: async (command) => {
      for (const dir of (env['PATH'] ?? '').split(path.delimiter).filter(Boolean)) {
        const found = await access(path.join(dir, command), constants.X_OK).then(
          () => true,
          () => false,
        );
        if (found) return true;
      }
      return false;
    },
    start: (command, args) => {
      const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'inherit'] });
      const done = new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', () => resolve());
      });
      return { done, stop: () => child.kill('SIGTERM') };
    },
    onInterrupt: (stop) => {
      const handler = () => stop();
      process.once('SIGINT', handler);
      return () => process.off('SIGINT', handler);
    },
    say,
  };
}
