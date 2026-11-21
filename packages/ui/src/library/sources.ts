/**
 * Where the music folder is (PRD §3.1): the UI scans and plays through a `LibrarySource` and never knows whether
 * the files are in memory, in a browser folder, on the NAS or on disk behind the desktop app. This is the only
 * part of the page that reads the network: the NAS server's API (§18.2) is here too.
 */
import type { ByteSource, FolderStats, LibraryFile, ScanSource, Song, TagEdit } from '@playlark/core';
import type { IndexStore } from './indexStore.ts';
import {
  TagCheckError,
  coverIds,
  decodeBase64,
  encodeBase64,
  parseIndex,
  parseStatsFile,
  statsChanges,
  isLibraryPath,
  isPlaylistPath,
  isSkippedName,
  memorySource,
  rewriteTags,
  sha256Hex,
} from '@playlark/core';

export type SourceKind = 'memory' | 'browser' | 'nas' | 'desktop';

export interface LibrarySource extends ScanSource {
  readonly kind: SourceKind;
  /** The folder's name, for the status bar. */
  readonly name: string;
  /** The folder's full path or address, when there is one to show on hover. */
  readonly where?: string;
  /** A song's or a playlist's whole file. */
  bytes(path: string): Promise<ArrayBuffer>;
  /** Writes playlists (PRD §9.3); absent where they can't be edited (the browser folder, §17). */
  readonly playlists?: PlaylistWriter;
  /** Writes song tags (PRD §11); absent where they can't be edited (the browser folder, §17). */
  readonly tags?: TagWriter;
  /** Songs someone else already read (the NAS server's scan, §18.3), so a rescan needn't read them again. */
  known?(): Promise<readonly Song[] | null>;
}

/** A song file's size and modified time, as the folder listing gives them. */
export interface FileFacts {
  readonly size: number;
  readonly mtime: number;
}

/** What a tag save gives back: the file's new facts and the edit that undoes it, or why it was refused. */
export type TagWriteResult =
  | { readonly ok: true; readonly file: FileFacts; readonly undo: TagEdit }
  | { readonly ok: false; readonly code: 'changed' | 'failed'; readonly message: string };

/** Tag writes in the music folder (PRD §11.3), refused when the file is no longer at `expected`. */
export interface TagWriter {
  write(path: string, edit: TagEdit, expected: FileFacts): Promise<TagWriteResult>;
}

/** Why a playlist write was refused: a conflict (`changed`, `deleted`, `exists`) or a failure. */
export type PlaylistWriteError =
  'changed' | 'deleted' | 'exists' | 'not-found' | 'outside' | 'busy' | 'failed';

/** What a playlist write gives back: the file's new version, or why it was refused. */
export type PlaylistResult =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly code: PlaylistWriteError; readonly message: string };

/**
 * Playlist writes in the music folder (PRD §9.3). Each carries the version last read (the SHA-256 of the bytes in
 * hex), and is refused when the file is no longer at it.
 */
export interface PlaylistWriter {
  /** Writes over version `base`; null creates the file, refused when it exists. */
  write(path: string, bytes: Uint8Array, base: string | null): Promise<PlaylistResult>;
  /** Renames a playlist; refused when `to` exists. */
  rename(from: string, to: string): Promise<PlaylistResult>;
  /** Moves the playlist to the trash if it is still at `base` (§11.4). */
  trash(path: string, base: string): Promise<PlaylistResult>;
}

/**
 * A library held in memory (tests and the scenarios' fake folder). Its playlists can be written, and `files` is
 * changed in place, so a test can also change a playlist "somewhere else".
 */
export function memoryLibrary(name: string, files: Record<string, Uint8Array>): LibrarySource {
  const get = (path: string) => {
    const b = files[path];
    if (!b) throw new Error(`${path} is not in the folder.`);
    return b;
  };
  const versionOf = (path: string) => (files[path] ? sha256Hex(files[path]) : null);
  const refuse = (code: PlaylistWriteError, message: string) =>
    Promise.resolve<PlaylistResult>({ ok: false, code, message });
  const playlists: PlaylistWriter = {
    write: (path, bytes, base) => {
      if (!isPlaylistPath(path)) return refuse('outside', 'That is not a playlist.');
      const found = versionOf(path);
      if (base === null && found !== null) return refuse('exists', 'It already exists.');
      if (base !== null && found === null) return refuse('deleted', 'It was deleted somewhere else.');
      if (base !== null && found !== base) return refuse('changed', 'It changed somewhere else.');
      files[path] = bytes.slice();
      return Promise.resolve({ ok: true, version: sha256Hex(bytes) });
    },
    rename: (from, to) => {
      const found = versionOf(from);
      if (found === null) return refuse('deleted', 'It was deleted somewhere else.');
      if (from.toLowerCase() !== to.toLowerCase() && files[to]) return refuse('exists', 'It already exists.');
      files[to] = get(from);
      if (to !== from) delete files[from];
      return Promise.resolve({ ok: true, version: found });
    },
    trash: (path, base) => {
      const found = versionOf(path);
      if (found === null) return refuse('deleted', 'It was deleted somewhere else.');
      if (found !== base) return refuse('changed', 'It changed somewhere else.');
      delete files[path];
      return Promise.resolve({ ok: true, version: found });
    },
  };
  // A write that fits the tag's padding keeps the size, so each one moves the time on, as a disk would.
  const mtimes = new Map<string, number>();
  const factsOf = (path: string): FileFacts => ({ size: get(path).length, mtime: mtimes.get(path) ?? 0 });
  const tags: TagWriter = {
    write: async (path, edit, expected) => {
      const name = path.split('/').pop() ?? path;
      const now = files[path] ? factsOf(path) : null;
      if (!now || now.size !== expected.size || now.mtime !== expected.mtime)
        return {
          ok: false,
          code: 'changed',
          message: `${name} changed somewhere else. Close Song Info and try again.`,
        };
      try {
        const { bytes, undo } = await rewriteTags(get(path), path, edit);
        if (bytes) {
          files[path] = bytes;
          mtimes.set(path, now.mtime + 1);
        }
        return { ok: true, file: factsOf(path), undo };
      } catch (e) {
        const reason =
          e instanceof TagCheckError
            ? 'the check after writing failed. The file wasn’t changed.'
            : e instanceof Error
              ? e.message
              : String(e);
        return { ok: false, code: 'failed', message: `Couldn’t save ${name}: ${reason}` };
      }
    },
  };
  return {
    kind: 'memory',
    name,
    list: () => Promise.resolve(Object.keys(files).map((path): LibraryFile => ({ path, ...factsOf(path) }))),
    open: (f) => Promise.resolve(memorySource(get(f.path))),
    bytes: (path) => Promise.resolve(get(path).slice().buffer),
    playlists,
    tags,
  };
}

/** Reads past what's asked in blocks this big, since tag readers make many small reads near each other. */
const BLOCK = 64 * 1024;

/** A file read over HTTP with Range requests, a block at a time, each block fetched once. */
export function rangeSource(url: string, size: number, fetcher: typeof fetch = fetch): ByteSource {
  const blocks = new Map<number, Promise<Uint8Array>>();
  const block = (n: number) => {
    let p = blocks.get(n);
    if (!p) {
      const start = n * BLOCK;
      const end = Math.min(size, start + BLOCK) - 1;
      p = fetcher(url, { headers: { Range: `bytes=${start}-${end}` } }).then(async (res) => {
        if (!res.ok) throw new Error(`Couldn’t read the file (${res.status}).`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        // A server that ignores Range sends the whole file: keep only the block.
        return res.status === 200 ? bytes.subarray(start, end + 1) : bytes;
      });
      blocks.set(n, p);
      p.catch(() => blocks.delete(n));
    }
    return p;
  };
  return {
    size,
    read: async (offset, length) => {
      const start = Math.max(0, Math.min(offset, size));
      const end = Math.min(size, start + Math.max(0, length));
      if (end <= start) return new Uint8Array();
      const first = Math.floor(start / BLOCK);
      const last = Math.floor((end - 1) / BLOCK);
      const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, i) => block(first + i)));
      const out = new Uint8Array(end - start);
      let at = 0;
      for (let i = 0; i < parts.length; i++) {
        const blockStart = (first + i) * BLOCK;
        const from = Math.max(start, blockStart) - blockStart;
        const to = Math.min(end, blockStart + BLOCK) - blockStart;
        out.set(parts[i]!.subarray(from, to), at);
        at += to - from;
      }
      return out;
    },
  };
}

/** A path as URL path segments, each one escaped. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * A folder served over HTTP: the NAS server (`/api/…`) and the desktop app (`app://playlark/media/…`) both list
 * the folder one way and serve each file with Range support.
 */
export function urlLibrary(options: {
  readonly kind: 'nas' | 'desktop';
  readonly name: string;
  readonly where?: string;
  readonly playlists?: PlaylistWriter;
  readonly tags?: TagWriter;
  readonly known?: () => Promise<readonly Song[] | null>;
  readonly list: () => Promise<readonly LibraryFile[]>;
  /** The URL a song's bytes are served from. */
  readonly mediaUrl: (path: string) => string;
  readonly fetcher?: typeof fetch;
}): LibrarySource {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  return {
    kind: options.kind,
    name: options.name,
    ...(options.where ? { where: options.where } : {}),
    ...(options.playlists ? { playlists: options.playlists } : {}),
    ...(options.tags ? { tags: options.tags } : {}),
    ...(options.known ? { known: options.known } : {}),
    list: options.list,
    open: (f) => Promise.resolve(rangeSource(options.mediaUrl(f.path), f.size, fetcher)),
    bytes: async (path) => {
      const res = await fetcher(options.mediaUrl(path));
      if (!res.ok)
        throw new Error(res.status === 404 ? 'The file is gone.' : `Couldn’t read the file (${res.status}).`);
      return res.arrayBuffer();
    },
  };
}

/** How long the server may take to say what it shares or to list the folder. */
export const SERVER_TIMEOUT_MS = 20_000;

/** A connection to the server the page came from. */
export interface ServerConnection {
  readonly source: LibrarySource;
  /** The server's index, covers and stats; the queue stays on this device in `local`. */
  readonly index: IndexStore;
  /** Calls `onChange` each time the server's library changes (§18.2), until the returned function is called. */
  watch(onChange: () => void): () => void;
}

type Fetcher = typeof fetch;

/** A failed write as the result the dialogs show. */
const failed = (message: string) => ({ ok: false as const, code: 'failed' as const, message });

/** A write's JSON result, or a failure naming what went wrong when the reply isn't one. */
async function writeResult<T extends { ok: boolean }>(
  reply: Promise<Response>,
): Promise<T | ReturnType<typeof failed>> {
  let res: Response;
  try {
    res = await reply;
  } catch {
    return failed('The server can’t be reached.');
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return failed(`The server said ${res.status}.`);
  }
  if (typeof body === 'object' && body !== null && 'ok' in body) return body as T;
  const message = (body as { message?: unknown } | null)?.message;
  return failed(typeof message === 'string' ? message : `The server said ${res.status}.`);
}

const sendJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function serverPlaylists(fetcher: Fetcher): PlaylistWriter {
  const at = (path: string) => `./api/playlists/${encodePath(path)}`;
  return {
    write: (path, bytes, base) =>
      writeResult<PlaylistResult>(
        fetcher(at(path), {
          method: 'PUT',
          headers: base === null ? { 'If-None-Match': '*' } : { 'If-Match': `"${base}"` },
          body: bytes as Uint8Array<ArrayBuffer>,
        }),
      ),
    rename: (from, to) => writeResult<PlaylistResult>(fetcher(at(from), sendJson({ to }))),
    trash: (path, base) =>
      writeResult<PlaylistResult>(
        fetcher(at(path), { method: 'DELETE', headers: { 'If-Match': `"${base}"` } }),
      ),
  };
}

function serverTags(fetcher: Fetcher): TagWriter {
  return {
    write: async (path, edit, expected) => {
      const cover = edit.cover ? { mime: edit.cover.mime, data: encodeBase64(edit.cover.data) } : edit.cover;
      const result = await writeResult<TagWriteResult>(
        fetcher(
          './api/tags',
          sendJson({ path, edit: { ...edit, ...(cover !== undefined ? { cover } : {}) }, expected }),
        ),
      );
      if (!result.ok) return result;
      // The undo edit's cover comes back as base64.
      const undo = result.undo as TagEdit & { cover?: { mime: string; type?: number; data: unknown } | null };
      if (!undo.cover) return result;
      const data = typeof undo.cover.data === 'string' ? decodeBase64(undo.cover.data) : null;
      if (!data) return failed('The server sent a cover it can’t put back.');
      return {
        ...result,
        undo: { ...undo, cover: { mime: undo.cover.mime, type: undo.cover.type ?? 3, data } },
      };
    },
  };
}

/** The server's index and covers, and the stats every device shares; the queue is kept in `local`. */
function serverIndexStore(
  fetcher: Fetcher,
  local: IndexStore,
  name: string,
): IndexStore & { known(): Promise<readonly Song[] | null>; readonly etag: string | null } {
  /** The stats as last read or sent, so a save sends only what changed since (§18.2). */
  let base: FolderStats = new Map();
  let etag: string | null = null;
  /** The covers the server has stored; one a song read here has but the server hasn't yet is kept in `local`. */
  let stored = new Set<string>();
  const index = async (root: string) => {
    const res = await fetcher('./api/library', { signal: AbortSignal.timeout(SERVER_TIMEOUT_MS) });
    if (res.status !== 200) return null;
    const read = parseIndex(await res.text(), root);
    if (read) {
      etag = res.headers.get('etag');
      stored = coverIds(read.songs);
    }
    return read;
  };
  return {
    get etag() {
      return etag;
    },
    known: async () => (await index(name).catch(() => null))?.songs ?? null,
    load: index,
    // The server keeps the index itself.
    save: () => Promise.resolve(),
    saveCover: (id, picture) => (stored.has(id) ? Promise.resolve() : local.saveCover(id, picture)),
    pruneCovers: (keep) => local.pruneCovers(keep),
    coverUrl: (id) => (stored.has(id) ? Promise.resolve(`./api/covers/${id}`) : local.coverUrl(id)),
    loadQueue: (root) => local.loadQueue(root),
    saveQueue: (q) => local.saveQueue(q),
    loadStats: async (root) => {
      const res = await fetcher('./api/stats');
      if (!res.ok) throw new Error(`Couldn’t read the favourites and play counts (${res.status}).`);
      const all = parseStatsFile(await res.text());
      if (!all) throw new Error('The favourites and play counts can’t be read.');
      base = all.get(root) ?? new Map();
      return base;
    },
    saveStats: async (_root, stats) => {
      const changes = statsChanges(base, stats);
      if (changes.length === 0) return;
      const res = await fetcher('./api/stats', sendJson({ changes }));
      if (!res.ok) throw new Error(`Couldn’t save the favourites and play counts (${res.status}).`);
      base = stats;
    },
  };
}

/**
 * The folder a Playlark server shares (PRD §18), from the page's own address, or null when the page isn't served
 * by one (a static host, the dev server with no server behind it). `local` keeps this device's own queue.
 */
export async function connectServer(
  local: IndexStore,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<ServerConnection | null> {
  const timeout = () => AbortSignal.timeout(SERVER_TIMEOUT_MS);
  let info: { name?: unknown; readOnly?: unknown };
  try {
    const res = await fetcher('./api/info', { signal: timeout() });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    info = (await res.json()) as typeof info;
  } catch {
    return null;
  }
  const name = info.name;
  if (typeof name !== 'string') return null;
  const index = serverIndexStore(fetcher, local, name);
  const writable = info.readOnly === false;
  const source = urlLibrary({
    kind: 'nas',
    name,
    list: async () => {
      const res = await fetcher('./api/files', { signal: timeout() });
      if (!res.ok) throw new Error(`The server said ${res.status}.`);
      return ((await res.json()) as { files: LibraryFile[] }).files;
    },
    known: index.known,
    mediaUrl: (path) => `./api/media/${encodePath(path)}`,
    fetcher,
    ...(writable ? { playlists: serverPlaylists(fetcher), tags: serverTags(fetcher) } : {}),
  });
  return {
    source,
    index,
    watch: (onChange) => {
      if (typeof EventSource === 'undefined') return () => undefined;
      const events = new EventSource('./api/events');
      events.addEventListener('library', (e) => {
        // The first event names the library the page may have read already.
        const etag = (JSON.parse((e as MessageEvent<string>).data) as { etag?: string }).etag ?? null;
        if (etag !== index.etag) onChange();
      });
      return () => events.close();
    },
  };
}

/** A file in a browser folder as a byte source: `File.slice` reads only the range asked for. */
function fileSource(file: File): ByteSource {
  return {
    size: file.size,
    read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
  };
}

/** A folder the user opened in Chrome or Edge with the File System Access API (PRD §17). Read-only. */
export function browserFolderLibrary(root: FileSystemDirectoryHandle): LibrarySource {
  const fileAt = async (path: string): Promise<File> => {
    const parts = path.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return (await dir.getFileHandle(parts.at(-1)!)).getFile();
  };
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string, out: LibraryFile[]): Promise<void> => {
    for await (const [name, handle] of dir.entries()) {
      if (isSkippedName(name)) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, path, out);
      else if (isLibraryPath(path)) {
        const file = await (handle as FileSystemFileHandle).getFile();
        out.push({ path, size: file.size, mtime: file.lastModified });
      }
    }
  };
  return {
    kind: 'browser',
    name: root.name,
    list: async () => {
      const out: LibraryFile[] = [];
      await walk(root, '', out);
      return out;
    },
    open: async (f) => fileSource(await fileAt(f.path)),
    bytes: async (path) => (await fileAt(path)).arrayBuffer(),
  };
}
