/** Songs and playlists named on the command line: a path in the music folder, a path from here, or a name. */
import path from 'node:path';
import { type Song, fold, playlistName } from '@playlark/core';
import { CliError } from './errors.ts';
import type { Where } from './folder.ts';
import type { Loaded } from './library.ts';

/** `input` as a path in the music folder: as given, else from `cwd` to a file inside the folder; or null. */
export function folderPath(input: string, where: Where, cwd: string): string | null {
  const full = path.resolve(cwd, input);
  for (const root of where.roots) {
    const rel = path.relative(root, full);
    if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  }
  return path.isAbsolute(input) ? null : input.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** The song each input names; an input that names none is an error. */
export function songsNamed(inputs: readonly string[], where: Where, cwd: string, loaded: Loaded): Song[] {
  return inputs.map((input) => {
    const at = folderPath(input, where, cwd);
    const song = at === null ? undefined : (loaded.songByPath.get(at) ?? loaded.songByPath.get(input));
    if (!song) throw new CliError(`${input} is not a song in ${where.folder}.`);
    return song;
  });
}

/** The playlists whose name (or path) is `name`, ignoring case and accents. */
export function playlistsNamed(name: string, where: Where, cwd: string, loaded: Loaded): string[] {
  const at = folderPath(name, where, cwd);
  if (at !== null && loaded.playlists.includes(at)) return [at];
  return loaded.playlists.filter((p) => fold(playlistName(p)) === fold(name));
}

/** The one playlist called `name`. */
export function playlistNamed(name: string, where: Where, cwd: string, loaded: Loaded): string {
  const found = playlistsNamed(name, where, cwd, loaded);
  if (found.length === 0)
    throw new CliError(`There is no playlist called “${name}”. playlark playlist list shows them.`);
  if (found.length > 1)
    throw new CliError(
      `More than one playlist is called “${name}”: ${found.join(', ')}. Give its path instead.`,
    );
  return found[0]!;
}
