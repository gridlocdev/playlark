/**
 * The server's own scan of the music folder (PRD §18.3): it reads every file once, keeps the index and covers in
 * its data folder, watches the folder for changes, and tells each open page when the library changed (§18.2).
 */
import { createHash } from 'node:crypto';
import { type FSWatcher, watch } from 'node:fs';
import path from 'node:path';
import { type ScanProgress, type Song, coverIds, makeIndex, parseIndex, scanLibrary } from '@playlark/core';
import { type IndexFolder, folderScanSource } from '@playlark/node-files';

/** Changes this close together are one rescan. */
const SETTLE_MS = 2_000;
/** How often the folder is read again where `fs.watch` can't be trusted (SMB, NFS) or `--poll` asks (§18.3). */
export const POLL_MS = 60_000;

export type LibraryEvent =
  | { readonly type: 'scan'; readonly progress: ScanProgress }
  | { readonly type: 'library'; readonly etag: string };

export interface ServerLibraryOptions {
  readonly root: string;
  /** The index's root: the folder's name, as the page calls it. */
  readonly name: string;
  readonly data: IndexFolder;
  /** Read the folder every POLL_MS instead of watching it. */
  readonly poll?: boolean;
  readonly pollMs?: number;
  readonly settleMs?: number;
  readonly now?: () => Date;
}

export class ServerLibrary {
  readonly #opts: ServerLibraryOptions;
  #songs: readonly Song[] = [];
  #index: { readonly text: string; readonly etag: string } | null = null;
  #running: Promise<void> | null = null;
  #again = false;
  #watcher: FSWatcher | null = null;
  /** Watches the folder above the music folder, for the music folder itself going away and coming back. */
  #parentWatcher: FSWatcher | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #poller: ReturnType<typeof setInterval> | null = null;
  readonly #listeners = new Set<(e: LibraryEvent) => void>();

  constructor(options: ServerLibraryOptions) {
    this.#opts = options;
  }

  /** Takes up the index kept from last time, starts a scan, and starts watching. */
  async start(): Promise<void> {
    const saved = await this.#opts.data.load().catch(() => null);
    const index = saved === null ? null : parseIndex(saved, this.#opts.name);
    if (index) this.#publish(index.songs, false);
    void this.scan();
    this.#watch();
  }

  /** The index as the page reads it, with its ETag, or null before the first scan. */
  get index(): { readonly text: string; readonly etag: string } | null {
    return this.#index;
  }

  /** Each scan's progress and each change to the library, until the returned function is called. */
  subscribe(listener: (e: LibraryEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Reads the folder again, reusing every file whose size and time haven't changed. One scan at a time. */
  scan(): Promise<void> {
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    this.#running = (async () => {
      do {
        this.#again = false;
        await this.#scanOnce().catch((e: unknown) => console.error('Scan failed:', e));
      } while (this.#again);
      this.#running = null;
    })();
    return this.#running;
  }

  /** A change made through the server (a tag or playlist save): rescan soon, as the watcher would. */
  changed(): void {
    this.#soon();
  }

  close(): void {
    this.#watcher?.close();
    this.#parentWatcher?.close();
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#poller) clearInterval(this.#poller);
    this.#listeners.clear();
  }

  async #scanOnce(): Promise<void> {
    const data = this.#opts.data;
    const songs = await scanLibrary(folderScanSource(this.#opts.root), {
      previous: this.#songs,
      onProgress: (progress) => this.#emit({ type: 'scan', progress }),
      onCover: (id, picture) => data.saveCover(id, picture.mime, picture.data),
    });
    this.#publish(songs, true);
  }

  #publish(songs: readonly Song[], save: boolean): void {
    const body = JSON.stringify(songs);
    const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;
    this.#songs = songs;
    if (this.#index?.etag === etag) return;
    const now = this.#opts.now?.() ?? new Date();
    this.#index = { text: JSON.stringify(makeIndex(this.#opts.name, songs, now)), etag };
    if (save) {
      const { data } = this.#opts;
      void data
        .save(this.#index.text)
        .then(() => data.pruneCovers(coverIds(songs)))
        .catch((e: unknown) => console.error('Couldn’t save the library index:', e));
    }
    this.#emit({ type: 'library', etag });
  }

  #emit(e: LibraryEvent): void {
    for (const listener of this.#listeners) listener(e);
  }

  #soon(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.scan();
    }, this.#opts.settleMs ?? SETTLE_MS);
  }

  #watch(): void {
    if (this.#opts.poll) {
      this.#startPolling();
      return;
    }
    if (!this.#watchFolder()) return;
    // On Linux a watcher follows the folder it was opened on, so a music folder that is deleted and made again
    // (a share mounted again, a folder replaced) would go quiet. Its parent says when it comes back.
    this.#parentWatcher = this.#watchParent();
  }

  /** Watches the music folder's parent for the folder itself; null when it can't (no permission, the file system root). */
  #watchParent(): FSWatcher | null {
    const { dir, base } = path.parse(path.resolve(this.#opts.root));
    try {
      const watcher = watch(dir, (_, name) => {
        if (name !== base) return;
        this.#watcher?.close();
        this.#watcher = null;
        this.#watchFolder();
        this.#soon();
      });
      // Without it the folder watcher still works; only a replaced folder goes unnoticed.
      watcher.on('error', () => watcher.close());
      return watcher;
    } catch {
      return null;
    }
  }

  /** Watches the music folder; false when it can't be watched and is polled instead. A folder that is gone isn't watched. */
  #watchFolder(): boolean {
    try {
      const watcher = watch(this.#opts.root, { recursive: true }, () => this.#soon());
      watcher.on('error', () => {
        watcher.close();
        // A watcher on a folder that was replaced can fail late, after the new one took its place.
        if (this.#watcher !== watcher) return;
        this.#watcher = null;
        this.#startPolling();
      });
      this.#watcher = watcher;
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true;
      // Not every file system can be watched: read it again on a timer instead.
      console.warn('Can’t watch the music folder, so it is read again every minute:', e);
      this.#startPolling();
      return false;
    }
  }

  #startPolling(): void {
    this.#poller ??= setInterval(() => void this.scan(), this.#opts.pollMs ?? POLL_MS);
    this.#poller.unref();
  }
}
