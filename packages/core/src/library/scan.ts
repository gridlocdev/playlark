/** Scanning the music folder (PRD §3, §4): read every music file's tags, a few at a time, reusing what hasn't changed. */
import type { ByteSource } from '../bytes.ts';
import { formatOfPath, readTags } from '../tags/readTags.ts';
import { type LibraryFile, isMusicPath } from './files.ts';
import { type Song, songFrom, unreadableSong } from './song.ts';
import { sortSongs } from './sort.ts';

/** How a scan reaches the folder: the UI, the server and the CLI each pass their own. */
export interface ScanSource {
  list(): Promise<readonly LibraryFile[]>;
  open(file: LibraryFile): Promise<ByteSource>;
}

export interface ScanProgress {
  readonly done: number;
  readonly total: number;
}

export interface ScanOptions {
  /** Songs from the last scan: a file whose size and mtime haven't changed isn't read again. */
  readonly previous?: readonly Song[];
  readonly concurrency?: number;
  readonly onProgress?: (p: ScanProgress) => void;
  readonly signal?: AbortSignal;
}

/** Reads one file into a song; never throws. */
export async function readSong(source: ScanSource, file: LibraryFile): Promise<Song> {
  try {
    const bytes = await source.open(file);
    const read = await readTags(bytes, file.path);
    return read.ok ? songFrom(file, read) : unreadableSong(file, formatOfPath(file.path), read.error);
  } catch (e) {
    return unreadableSong(file, formatOfPath(file.path), e instanceof Error ? e.message : String(e));
  }
}

/** Every music file in the folder as a song, sorted. */
export async function scanLibrary(source: ScanSource, options: ScanOptions = {}): Promise<Song[]> {
  const files = (await source.list()).filter((f) => isMusicPath(f.path));
  const known = new Map((options.previous ?? []).map((s) => [s.path, s]));
  const songs: Song[] = new Array<Song>(files.length);
  let next = 0;
  let done = 0;
  options.onProgress?.({ done, total: files.length });
  const worker = async () => {
    while (next < files.length) {
      options.signal?.throwIfAborted();
      const i = next++;
      const file = files[i]!;
      const old = known.get(file.path);
      songs[i] =
        old && old.size === file.size && old.mtime === file.mtime ? old : await readSong(source, file);
      done++;
      options.onProgress?.({ done, total: files.length });
    }
  };
  const workers = Math.max(1, Math.min(options.concurrency ?? 8, files.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return sortSongs(songs);
}
