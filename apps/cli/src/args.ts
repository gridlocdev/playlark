/** `playlark [--dir <folder>] [--json] <command> …` (PRD §20), read with node:util's parseArgs. */
import { parseArgs } from 'node:util';
import { CliError } from './errors.ts';

/** Options that take a value, by the commands they go with. */
const FILTERS = ['artist', 'album', 'genre', 'year'] as const;
const TAG_FIELDS = [
  'title',
  'artist',
  'album',
  'album-artist',
  'genre',
  'track',
  'track-total',
  'disc',
  'disc-total',
  'year',
  'compilation',
] as const;

export type Filter = (typeof FILTERS)[number];
export type TagField = (typeof TAG_FIELDS)[number];

export interface Parsed {
  readonly dir?: string;
  readonly json: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly command?: string;
  readonly rest: readonly string[];
  /** The value options given, by name. */
  readonly values: Readonly<Partial<Record<Filter | TagField, string>>>;
}

const VALUE_OPTIONS = [...new Set<string>([...FILTERS, ...TAG_FIELDS])];

export function parse(argv: readonly string[]): Parsed {
  let read;
  try {
    read = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        dir: { type: 'string', short: 'd' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        ...Object.fromEntries(VALUE_OPTIONS.map((o) => [o, { type: 'string' as const }])),
      },
    });
  } catch (e) {
    throw new CliError(`${e instanceof Error ? e.message : String(e)} Run playlark --help for the commands.`);
  }
  const { values, positionals } = read;
  const given: Partial<Record<string, string>> = {};
  const all = values as Record<string, string | boolean | undefined>;
  for (const o of VALUE_OPTIONS) {
    const v = all[o];
    if (typeof v === 'string') given[o] = v;
  }
  const [command, ...rest] = positionals;
  return {
    ...(typeof values.dir === 'string' ? { dir: values.dir } : {}),
    json: values.json === true,
    help: values.help === true,
    version: values.version === true,
    ...(command !== undefined ? { command } : {}),
    rest,
    values: given,
  };
}

/** Refuses value options the command doesn't take. */
export function allowOnly(parsed: Parsed, allowed: readonly string[], command: string): void {
  const extra = Object.keys(parsed.values).filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw new CliError(`--${extra[0]} doesn’t go with ${command}.`);
}

export const FILTER_OPTIONS: readonly string[] = FILTERS;
export const TAG_OPTIONS: readonly string[] = TAG_FIELDS;

export const USAGE = `playlark [--dir <folder>] [--json] <command>

The folder is --dir, else PLAYLARK_DIR, else the folder the Playlark app has open.

  scan                                   rescan and count songs, albums, artists and unreadable files
  songs   [--artist …] [--album …] [--genre …] [--year …]
  albums  [the same filters]
  artists [the same filters]
  search <words…>                        every word must start a word in the title, artist, album, genre or file name
  check                                  missing tags, albums without covers, likely duplicates, unreadable files
  playlist list
  playlist show <name>
  playlist create <name> [songs…]
  playlist add <name> <songs…>
  playlist remove <name> <positions…>    positions as playlist show numbers them
  playlist check [<name>]                entries whose song isn't in the folder
  tags show <song>
  tags set <songs…> [--title …] [--artist …] [--album …] [--album-artist …] [--genre …]
                    [--track n] [--track-total n] [--disc n] [--disc-total n] [--year n] [--compilation yes|no]
                                         an empty value ("") takes the tag out
  play <song | playlist name | search words>   through afplay, ffplay or paplay; Ctrl-C stops

Songs are paths in the music folder, or paths from here to files inside it.
Exit codes: 0 done, 1 error or usage, 2 conflict (changed or exists elsewhere).
With --json every command prints one JSON object: { "ok": true, … } or { "ok": false, "error": "…", "exit": n }.`;
