/** Editing a playlist's entries (PRD §9.2) and naming its file (§9.1). Pure: every edit returns a new playlist. */
import { folderOf } from '../library/files.ts';
import { type PlaylistFile, entryFor } from './m3u.ts';

/** Adds songs at the end (duplicates are allowed). */
export function addEntries(file: PlaylistFile, playlistPath: string, paths: readonly string[]): PlaylistFile {
  if (paths.length === 0) return file;
  return { ...file, entries: [...file.entries, ...paths.map((p) => entryFor(playlistPath, p))] };
}

/** Takes out the entries at `indexes`; their comments move to the entry after, so none are lost. */
export function removeEntries(file: PlaylistFile, indexes: readonly number[]): PlaylistFile {
  const drop = new Set(indexes.filter((i) => i >= 0 && i < file.entries.length));
  if (drop.size === 0) return file;
  const entries = [];
  let carried: string[] = [];
  for (const [i, e] of file.entries.entries()) {
    if (drop.has(i)) carried.push(...e.comments);
    else {
      entries.push(carried.length > 0 ? { ...e, comments: [...carried, ...e.comments] } : e);
      carried = [];
    }
  }
  return { ...file, entries, trailing: [...carried, ...file.trailing] };
}

/**
 * Moves the entries at `indexes`, keeping their order, to the gap `to` (0 is before the first entry, the entry
 * count after the last), counted before the move.
 */
export function moveEntries(file: PlaylistFile, indexes: readonly number[], to: number): PlaylistFile {
  const moving = [...new Set(indexes)].filter((i) => i >= 0 && i < file.entries.length).sort((a, b) => a - b);
  if (moving.length === 0) return file;
  const set = new Set(moving);
  const gap = Math.max(0, Math.min(to, file.entries.length));
  const before = moving.filter((i) => i < gap).length;
  const rest = file.entries.filter((_, i) => !set.has(i));
  const at = gap - before;
  const entries = [...rest.slice(0, at), ...moving.map((i) => file.entries[i]!), ...rest.slice(at)];
  return sameEntries(file, { ...file, entries }) ? file : { ...file, entries };
}

/** True when both have the same entries in the same order (an edit that changes nothing records nothing). */
export function sameEntries(a: PlaylistFile, b: PlaylistFile): boolean {
  return (
    a.entries.length === b.entries.length &&
    a.entries.every(
      (e, i) => e === b.entries[i] || (e.raw === b.entries[i]!.raw && e.path === b.entries[i]!.path),
    )
  );
}

/** The folder new playlists go in, at the top of the music folder. */
export const PLAYLIST_FOLDER = 'Playlists';

/** A playlist name made safe as a file name: characters not allowed on any system become "-". */
export function safeName(name: string): string {
  const s = [...name]
    .map((c) => (c.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(c) ? '-' : c))
    .join('')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  return s === '' ? 'Playlist' : s;
}

/** `folder/name.ext`, with " 2", " 3"… added when the path is taken (compared ignoring case). */
function free(folder: string, name: string, ext: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  const at = (n: string) => (folder === '' ? `${n}.${ext}` : `${folder}/${n}.${ext}`);
  let candidate = at(name);
  for (let i = 2; lower.has(candidate.toLowerCase()); i++) candidate = at(`${name} ${i}`);
  return candidate;
}

/** Where a new playlist called `name` is written (PRD §9.1). */
export function newPlaylistPath(name: string, taken: ReadonlySet<string>): string {
  return free(PLAYLIST_FOLDER, safeName(name), 'm3u8', taken);
}

/** The path a playlist gets when renamed: same folder and extension, the new name. */
export function renamedPath(path: string, name: string, taken: ReadonlySet<string>): string {
  const ext = /\.m3u$/i.test(path) ? 'm3u' : 'm3u8';
  const others = new Set([...taken].filter((t) => t.toLowerCase() !== path.toLowerCase()));
  return free(folderOf(path), safeName(name), ext, others);
}
