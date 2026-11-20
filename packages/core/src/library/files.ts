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
