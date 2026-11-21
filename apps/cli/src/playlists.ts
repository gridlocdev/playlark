/**
 * `playlist list | show | create | add | remove | check` (PRD §20): the same `.m3u8` files the app writes (§9.1),
 * each write checked against the version read and made under the playlist's lock file, so a change made elsewhere
 * in between is a conflict (exit 2), never overwritten.
 */
import { readFile } from 'node:fs/promises';
import {
  EMPTY_PLAYLIST,
  type PlaylistFile,
  addEntries,
  newPlaylistPath,
  parsePlaylist,
  playlistName,
  removeEntries,
  writePlaylist,
} from '@playlark/core';
import { resolveInside, versionOf, writePlaylistFile } from '@playlark/node-files';
import { type Output, songLine } from './browse.ts';
import { CliError } from './errors.ts';
import type { Where } from './folder.ts';
import type { Loaded } from './library.ts';
import { playlistNamed, playlistsNamed, songsNamed } from './paths.ts';

interface Read {
  readonly path: string;
  readonly file: PlaylistFile;
  readonly version: string;
}

async function readPlaylist(where: Where, loaded: Loaded, rel: string): Promise<Read> {
  const bytes = new Uint8Array(await readFile(await resolveInside(where.folder, rel)));
  const file = parsePlaylist(bytes, rel, where.folder, (p) => loaded.songByPath.has(p));
  return { path: rel, file, version: versionOf(bytes) };
}

async function save(where: Where, loaded: Loaded, rel: string, file: PlaylistFile, base: string | null) {
  const bytes = writePlaylist(file, rel, (p) => loaded.songByPath.get(p));
  await writePlaylistFile(where.folder, rel, bytes, base);
}

/** Entries whose song isn't in the folder, numbered from 1. */
function missingEntries(read: Read, loaded: Loaded): { position: number; entry: string }[] {
  return read.file.entries.flatMap((e, i) =>
    e.path !== null && loaded.songByPath.has(e.path) ? [] : [{ position: i + 1, entry: e.raw }],
  );
}

function entryLines(read: Read, loaded: Loaded): { lines: string[]; json: Record<string, unknown>[] } {
  const lines: string[] = [];
  const json: Record<string, unknown>[] = [];
  read.file.entries.forEach((e, i) => {
    const song = e.path === null ? undefined : loaded.songByPath.get(e.path);
    lines.push(`${String(i + 1).padStart(3)}  ${song ? songLine(song) : `${e.raw}  (missing)`}`);
    json.push({
      position: i + 1,
      entry: e.raw,
      path: song?.path ?? null,
      ...(song ? { title: song.title, artist: song.artist } : {}),
    });
  });
  return { lines, json };
}

function positionsOf(inputs: readonly string[], count: number): number[] {
  if (inputs.length === 0) throw new CliError('playlist remove needs the positions to take out.');
  const out = new Set<number>();
  for (const input of inputs) {
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > count)
      throw new CliError(`${input} is not a position in the playlist (1 to ${count}).`);
    out.add(n - 1);
  }
  return [...out].sort((a, b) => a - b);
}

export async function playlistCommand(
  args: readonly string[],
  where: Where,
  cwd: string,
  loaded: Loaded,
): Promise<Output> {
  const [sub, name, ...more] = args;
  const need = (what: string) => {
    if (name === undefined) throw new CliError(`playlist ${sub} needs ${what}.`);
    return name;
  };
  switch (sub) {
    case 'list': {
      const reads = await Promise.all(loaded.playlists.map((p) => readPlaylist(where, loaded, p)));
      return {
        lines: reads.length
          ? reads.map((r) => `${playlistName(r.path)} (${r.file.entries.length} songs)  ${r.path}`)
          : ['No playlists yet.'],
        json: {
          playlists: reads.map((r) => ({
            name: playlistName(r.path),
            path: r.path,
            entries: r.file.entries.length,
            missing: missingEntries(r, loaded).length,
          })),
        },
      };
    }
    case 'show': {
      const read = await readPlaylist(where, loaded, playlistNamed(need('a name'), where, cwd, loaded));
      const { lines, json } = entryLines(read, loaded);
      return {
        lines: [`${playlistName(read.path)}  ${read.path}`, ...lines],
        json: { name: playlistName(read.path), path: read.path, entries: json },
      };
    }
    case 'create': {
      const title = need('a name');
      if (playlistsNamed(title, where, cwd, loaded).length > 0)
        throw new CliError(`“${title}” already exists.`, 2);
      const rel = newPlaylistPath(title, new Set(loaded.playlists));
      const songs = songsNamed(more, where, cwd, loaded);
      const file = addEntries(
        EMPTY_PLAYLIST,
        rel,
        songs.map((s) => s.path),
      );
      await save(where, loaded, rel, file, null);
      return {
        lines: [`Made ${rel} with ${songs.length} song${songs.length === 1 ? '' : 's'}.`],
        json: { path: rel, entries: songs.length },
      };
    }
    case 'add': {
      const read = await readPlaylist(where, loaded, playlistNamed(need('a name'), where, cwd, loaded));
      if (more.length === 0) throw new CliError('playlist add needs the songs to add.');
      const songs = songsNamed(more, where, cwd, loaded);
      const file = addEntries(
        read.file,
        read.path,
        songs.map((s) => s.path),
      );
      await save(where, loaded, read.path, file, read.version);
      return {
        lines: [`Added ${songs.length} song${songs.length === 1 ? '' : 's'} to ${read.path}.`],
        json: { path: read.path, entries: file.entries.length },
      };
    }
    case 'remove': {
      const read = await readPlaylist(where, loaded, playlistNamed(need('a name'), where, cwd, loaded));
      const positions = positionsOf(more, read.file.entries.length);
      const file = removeEntries(read.file, positions);
      await save(where, loaded, read.path, file, read.version);
      return {
        lines: [`Took ${positions.length} out of ${read.path}.`],
        json: { path: read.path, entries: file.entries.length },
      };
    }
    case 'check': {
      const paths = name === undefined ? loaded.playlists : [playlistNamed(name, where, cwd, loaded)];
      const reads = await Promise.all(paths.map((p) => readPlaylist(where, loaded, p)));
      const found = reads.map((r) => ({ path: r.path, missing: missingEntries(r, loaded) }));
      const bad = found.filter((f) => f.missing.length > 0);
      return {
        lines: bad.length
          ? bad.flatMap((f) => [
              f.path,
              ...f.missing.map((m) => `${String(m.position).padStart(3)}  ${m.entry}`),
            ])
          : ['Every playlist entry is in the folder.'],
        json: { playlists: found },
      };
    }
    case undefined:
      throw new CliError('playlist needs list, show, create, add, remove or check.');
    default:
      throw new CliError(
        `playlist ${sub} isn’t a playlist command: use list, show, create, add, remove or check.`,
      );
  }
}
