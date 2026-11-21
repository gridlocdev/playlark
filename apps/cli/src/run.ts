/** One run of `playlark` (PRD §20): parse, rescan, run the command, print, and give the exit code. */
import { FolderError } from '@playlark/node-files';
import { FILTER_OPTIONS, type Filter, TAG_OPTIONS, USAGE, allowOnly, parse } from './args.ts';
import {
  type Output,
  albumsReport,
  artistsReport,
  checkReport,
  scanReport,
  searchReport,
  songsReport,
} from './browse.ts';
import { CliError } from './errors.ts';
import { type Platform, resolveWhere } from './folder.ts';
import { loadLibrary } from './library.ts';
import { type Player, play, songsToPlay } from './play.ts';
import { playlistCommand } from './playlists.ts';
import { tagsCommand } from './tags.ts';

export const VERSION = '0.1.0';

export interface RunContext extends Platform {
  /** Standard output, one line at a time. */
  readonly out: (line: string) => void;
  /** Standard error. */
  readonly err: (line: string) => void;
  /** How `play` plays; tests pass one that makes no sound. */
  readonly player: Player;
  readonly now?: () => Date;
}

const COMMANDS = ['scan', 'songs', 'albums', 'artists', 'search', 'check', 'playlist', 'tags', 'play'];

/** A conflict is exit 2; any other failure exit 1. */
function exitOf(e: unknown): { message: string; exit: 1 | 2 } {
  if (e instanceof CliError) return { message: e.message, exit: e.exit };
  if (e instanceof FolderError)
    return {
      message: e.message,
      exit: e.code === 'changed' || e.code === 'deleted' || e.code === 'exists' ? 2 : 1,
    };
  return { message: e instanceof Error ? e.message : String(e), exit: 1 };
}

async function command(argv: readonly string[], ctx: RunContext): Promise<Output | 'help'> {
  const parsed = parse(argv);
  if (parsed.version) return { lines: [`playlark ${VERSION}`], json: { version: VERSION } };
  if (parsed.help || parsed.command === 'help') return 'help';
  const name = parsed.command;
  if (name === undefined) throw new CliError(`No command given.\n\n${USAGE}`);
  if (!COMMANDS.includes(name))
    throw new CliError(`${name} isn’t a command. Run playlark --help for the list.`);
  allowOnly(
    parsed,
    name === 'tags' ? TAG_OPTIONS : ['songs', 'albums', 'artists'].includes(name) ? FILTER_OPTIONS : [],
    name,
  );
  const where = await resolveWhere(parsed.dir, ctx);
  const loaded = await loadLibrary(where, ctx.now?.());
  const filters = parsed.values as Partial<Record<Filter, string>>;
  const noArgs = () => {
    if (parsed.rest.length > 0) throw new CliError(`${name} takes no arguments: ${parsed.rest.join(' ')}`);
  };
  switch (name) {
    case 'scan':
      noArgs();
      return scanReport(loaded);
    case 'songs':
      noArgs();
      return songsReport(loaded, filters);
    case 'albums':
      noArgs();
      return albumsReport(loaded, filters);
    case 'artists':
      noArgs();
      return artistsReport(loaded, filters);
    case 'search':
      return searchReport(loaded, parsed.rest.join(' '));
    case 'check':
      noArgs();
      return checkReport(loaded);
    case 'playlist':
      return playlistCommand(parsed.rest, where, ctx.cwd, loaded);
    case 'tags':
      return tagsCommand(parsed.rest, parsed.values, where, ctx.cwd, loaded, ctx.now?.());
    default: {
      const songs = await songsToPlay(parsed.rest, where, ctx.cwd, loaded);
      return play(songs, where, ctx.platform, ctx.player);
    }
  }
}

/** Runs one command and gives its exit code. Never throws. */
export async function run(argv: readonly string[], ctx: RunContext): Promise<number> {
  const json = argv.includes('--json');
  try {
    const output = await command(argv, ctx);
    if (output === 'help') {
      ctx.out(USAGE);
      return 0;
    }
    if (json) ctx.out(JSON.stringify({ ok: true, ...output.json }, null, 2));
    else for (const line of output.lines) ctx.out(line);
    return 0;
  } catch (e) {
    const { message, exit } = exitOf(e);
    if (json) ctx.out(JSON.stringify({ ok: false, error: message, exit }, null, 2));
    else ctx.err(message);
    return exit;
  }
}
