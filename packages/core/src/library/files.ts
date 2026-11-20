/** Which files in the music folder are music (PRD §3). */
import { formatOfPath } from '../tags/readTags.ts';

/** A file in the library folder, by its path relative to the folder with "/" between names. */
export interface LibraryFile {
  readonly path: string;
  readonly size: number;
  /** Last modified, in milliseconds since 1970. */
  readonly mtime: number;
}

/** Folders NAS systems and other OSes leave behind, never music. */
const SKIPPED_FOLDERS = new Set([
  '@eaDir',
  '#recycle',
  '#snapshot',
  '$RECYCLE.BIN',
  'System Volume Information',
  'lost+found',
]);

/** True for a file or folder name the scan never goes into: hidden names and system folders. */
export function isSkippedName(name: string): boolean {
  return name.startsWith('.') || SKIPPED_FOLDERS.has(name);
}

/** True when a path (relative, "/"-separated) is a music file the scan reads. */
export function isMusicPath(path: string): boolean {
  if (path.split('/').some(isSkippedName)) return false;
  return formatOfPath(path) !== null;
}

/** Folder images used as covers, best first (PRD §4.6). */
const COVER_NAMES = ['cover', 'folder', 'front', 'album'] as const;
const COVER_EXTENSIONS = ['jpg', 'jpeg', 'png'] as const;

/** How good a folder image is as a cover: 0 is best; -1 when the name isn't a cover's. */
export function coverRank(path: string): number {
  const name = baseName(path).toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return -1;
  const n = COVER_NAMES.indexOf(name.slice(0, dot) as (typeof COVER_NAMES)[number]);
  const e = COVER_EXTENSIONS.indexOf(name.slice(dot + 1) as (typeof COVER_EXTENSIONS)[number]);
  return n < 0 || e < 0 ? -1 : n * COVER_EXTENSIONS.length + e;
}

/** True for a folder image the scan may use as a cover. */
export function isCoverPath(path: string): boolean {
  return !path.split('/').some(isSkippedName) && coverRank(path) >= 0;
}

/** True for a playlist file (PRD §9.1): `.m3u8` or `.m3u`, anywhere in the folder. */
export function isPlaylistPath(path: string): boolean {
  if (path.split('/').some(isSkippedName)) return false;
  return /\.m3u8?$/i.test(path);
}

/** True for every file a listing hands the app: music files, folder covers and playlists. */
export function isLibraryPath(path: string): boolean {
  return isMusicPath(path) || isCoverPath(path) || isPlaylistPath(path);
}

/** The folder part of a path, "" at the top. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** The file name without its folder. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The file name without its folder or extension. */
export function stem(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
