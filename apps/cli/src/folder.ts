/**
 * Which music folder the CLI works on, and where its index, stats and trash live (PRD §20): the desktop app's data
 * folder, so both see the same favourites, play counts and trash.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { libraryDir } from '@playlark/node-files';
import { CliError } from './errors.ts';

export interface Where {
  /** The music folder, absolute, links resolved. */
  readonly folder: string;
  /** The folder as given and with links resolved: a path to a song may start with either. */
  readonly roots: readonly string[];
  /** The folder's name: what the index and stats are keyed by, as in the desktop app. */
  readonly name: string;
  /** The desktop app's data folder: its trash. */
  readonly data: string;
  /** This folder's index, covers and stats in the data folder: the same place the desktop app uses for it. */
  readonly indexDir: string;
  /** The folder the desktop app remembers, if any: its index is never pruned. */
  readonly remembered: string | null;
}

export interface Platform {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly cwd: string;
}

/** Electron's userData for productName Playlark on each system, unless PLAYLARK_USER_DATA says otherwise. */
export function desktopDataDir({ env, platform, home }: Platform): string {
  if (env['PLAYLARK_USER_DATA']) return path.resolve(env['PLAYLARK_USER_DATA']);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Playlark');
  if (platform === 'win32')
    return path.join(env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming'), 'Playlark');
  return path.join(env['XDG_CONFIG_HOME'] ?? path.join(home, '.config'), 'Playlark');
}

/** The folder the desktop app last opened (its `folder.json`), or null. */
export async function rememberedFolder(data: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(path.join(data, 'folder.json'), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  try {
    const v: unknown = JSON.parse(text);
    const folder = typeof v === 'object' && v !== null ? (v as Record<string, unknown>)['folder'] : null;
    return typeof folder === 'string' && folder !== '' ? folder : null;
  } catch {
    return null;
  }
}

async function isFolder(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

/** `--dir`, else PLAYLARK_DIR, else the desktop app's folder. */
export async function resolveWhere(dir: string | undefined, p: Platform): Promise<Where> {
  const data = desktopDataDir(p);
  const remembered = await rememberedFolder(data);
  const chosen = dir ?? p.env['PLAYLARK_DIR'] ?? remembered;
  if (!chosen)
    throw new CliError(
      'No music folder. Pass --dir <folder>, set PLAYLARK_DIR, or open a folder in the Playlark app.',
    );
  const asked = path.resolve(p.cwd, chosen);
  if (!(await isFolder(asked))) throw new CliError(`${asked} is not a folder.`);
  const folder = await realpath(asked);
  return {
    folder,
    roots: [...new Set([folder, asked])],
    name: path.basename(asked) || asked,
    data,
    indexDir: await libraryDir(data, folder),
    remembered,
  };
}
