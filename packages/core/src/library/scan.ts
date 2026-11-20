/** Scanning the music folder (PRD §3, §4): read every music file's tags, a few at a time, reusing what hasn't changed. */
import type { ByteSource } from '../bytes.ts';
import { sha256Hex } from '../sha256.ts';
import { formatOfPath, readTags } from '../tags/readTags.ts';
import type { Picture } from '../tags/types.ts';
import { type LibraryFile, coverRank, folderOf, isCoverPath, isMusicPath } from './files.ts';
import { type CoverRef, type Song, songFrom, unreadableSong } from './song.ts';
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
  /** Each song as it is read or reused, before the folder covers are filled in (for showing songs early). */
  readonly onSong?: (song: Song) => void;
  /** Each embedded cover, named by the SHA-256 of its bytes, to store beside the index (§3.2). */
  readonly onCover?: (id: string, picture: Picture) => Promise<void> | void;
  readonly signal?: AbortSignal;
}

/** One file read: the song, and the picture it carries. Never throws. */
export async function readSong(
  source: ScanSource,
  file: LibraryFile,
): Promise<{ song: Song; picture?: Picture }> {
  try {
    const bytes = await source.open(file);
    const read = await readTags(bytes, file.path);
    if (!read.ok) return { song: unreadableSong(file, formatOfPath(file.path), read.error) };
    const song = songFrom(file, read);
    return read.cover ? { song, picture: read.cover } : { song };
  } catch (e) {
    return {
      song: unreadableSong(file, formatOfPath(file.path), e instanceof Error ? e.message : String(e)),
    };
  }
}

/** The best cover image in each folder (§4.6), by folder. */
export function folderCovers(files: readonly LibraryFile[]): Map<string, string> {
  const best = new Map<string, { path: string; rank: number }>();
  for (const f of files) {
    if (!isCoverPath(f.path)) continue;
    const rank = coverRank(f.path);
    const folder = folderOf(f.path);
    const have = best.get(folder);
    if (!have || rank < have.rank) best.set(folder, { path: f.path, rank });
  }
  return new Map(Array.from(best, ([folder, b]) => [folder, b.path]));
}

/** The song with `cover` in place of whatever cover it had. */
function withCover(song: Song, cover: CoverRef | undefined): Song {
  if (song.cover === cover) return song;
  const { cover: _old, ...rest } = song;
  return cover ? { ...rest, cover } : rest;
}

/** Every music file in the folder as a song, sorted, with its cover (§3.3, §4.6). */
export async function scanLibrary(source: ScanSource, options: ScanOptions = {}): Promise<Song[]> {
  const listed = await source.list();
  const files = listed.filter((f) => isMusicPath(f.path));
  const covers = folderCovers(listed);
  const known = new Map((options.previous ?? []).map((s) => [s.path, s]));
  const songs: Song[] = new Array<Song>(files.length);
  const stored = new Set<string>();
  let next = 0;
  let done = 0;
  options.onProgress?.({ done, total: files.length });
  const read = async (file: LibraryFile): Promise<Song> => {
    const old = known.get(file.path);
    if (old && old.size === file.size && old.mtime === file.mtime) return old;
    const { song, picture } = await readSong(source, file);
    if (!picture) return song;
    const id = sha256Hex(picture.data);
    if (!stored.has(id)) {
      stored.add(id);
      await options.onCover?.(id, picture);
    }
    return withCover(song, { kind: 'embedded', id, mime: picture.mime });
  };
  const worker = async () => {
    while (next < files.length) {
      options.signal?.throwIfAborted();
      const i = next++;
      const song = await read(files[i]!);
      songs[i] = song;
      done++;
      options.onSong?.(song);
      options.onProgress?.({ done, total: files.length });
    }
  };
  const workers = Math.max(1, Math.min(options.concurrency ?? 8, files.length));
  await Promise.all(Array.from({ length: workers }, worker));
  // A picture in the file wins; otherwise the folder's image, which may have come or gone since the last scan.
  const finished = songs.map((s) => {
    if (s.cover?.kind === 'embedded') return s;
    const image = covers.get(folderOf(s.path));
    return withCover(s, image ? { kind: 'file', path: image } : undefined);
  });
  return sortSongs(finished);
}
