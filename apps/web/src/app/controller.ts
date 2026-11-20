/**
 * The window's state as signals: the music folder and its songs, the scan, the cursor in the song list, the open
 * dialog and the status-bar notice. Components read these; commands call the methods.
 */
import { batch, computed, effect, signal } from '@preact/signals';
import {
  coverIds,
  findMoves,
  makeIndex,
  scanLibrary,
  sortSongs,
  type ScanProgress,
  type Song,
} from '@playlark/core';
import { Player, after, every, type AudioEngine, type IndexStore, type LibrarySource } from '@playlark/ui';

export type DialogKind = 'commands' | 'shortcuts' | 'unreadable';

/** How often the song list takes in what a scan has found so far (PRD §3.3). */
export const SCAN_UPDATE_MS = 500;

export interface Notice {
  readonly text: string;
  readonly tone?: 'error';
  /** Stays until dismissed or replaced. Errors are sticky. */
  readonly sticky?: boolean;
  readonly action?: { readonly label: string; readonly run: () => void };
}

/** How long a notice stays: 6 s, or 12 s with an action (PRD §13). */
export const NOTICE_MS = 6_000;
export const NOTICE_ACTION_MS = 12_000;

/** Where the folder comes from: the user picks one (desktop, Chrome), or it is fixed (NAS). */
export interface FolderChooser {
  /** Asks for a folder; null when the user cancelled. */
  choose(): Promise<LibrarySource | null>;
}

export interface ControllerOptions {
  readonly engine: AudioEngine;
  readonly version: string;
  /** Absent when the folder can't be changed here (the NAS) or can't be opened at all (§17). */
  readonly folders?: FolderChooser;
  /** Why no folder can be opened here, shown in place of the song list (§17). */
  readonly cannotOpen?: string;
  readonly volume?: number;
  readonly onVolume?: (volume: number) => void;
  /** Where the index and its covers are kept between runs (§3.2). Absent: nothing is kept. */
  readonly index?: IndexStore;
  /** A URL an `<img>` can show for bytes read from the folder (a folder's cover image). */
  readonly imageUrl?: (bytes: ArrayBuffer, mime: string) => string;
  /** Today, for the index's scan date. */
  readonly now?: () => Date;
}

export class AppController {
  readonly version: string;
  readonly folders: FolderChooser | undefined;
  readonly cannotOpen: string | undefined;
  readonly source = signal<LibrarySource | null>(null);
  /** Every song in the folder, sorted (§6.2). */
  readonly songs = signal<readonly Song[]>([]);
  readonly byPath = computed(() => new Map(this.songs.value.map((s) => [s.path, s])));
  /** The scan under way, or null. */
  readonly scanning = signal<ScanProgress | null>(null);
  /** True once the first scan of the open folder has finished. */
  readonly scanned = signal(false);
  readonly notice = signal<Notice | null>(null);
  /** Read out by the status bar's live region. */
  readonly announcement = signal('');
  readonly dialog = signal<DialogKind | null>(null);
  /** The song the list's cursor is on. */
  readonly cursor = signal<string | null>(null);
  readonly queueShown = signal(false);
  /** The playing song's cover, as a URL, or null for the placeholder (§4.6). */
  readonly nowCover = signal<string | null>(null);
  readonly player: Player;

  readonly #index: IndexStore | undefined;
  readonly #imageUrl: ((bytes: ArrayBuffer, mime: string) => string) | undefined;
  readonly #now: () => Date;
  /** Cover URLs made from folder images, by path, for the folder open now. */
  #imageUrls = new Map<string, Promise<string | null>>();
  #noticeTimer: (() => void) | null = null;
  #scan: AbortController | null = null;

  constructor(options: ControllerOptions) {
    this.version = options.version;
    this.folders = options.folders;
    this.cannotOpen = options.cannotOpen;
    this.#index = options.index;
    this.#imageUrl = options.imageUrl;
    this.#now = options.now ?? (() => new Date());
    this.player = new Player({
      engine: options.engine,
      bytes: (path) => {
        const source = this.source.peek();
        if (!source) return Promise.reject(new Error('No music folder is open.'));
        return source.bytes(path);
      },
      song: (path) => this.byPath.peek().get(path),
      say: (text, tone) => this.say(text, tone ? { tone } : {}),
      ...(options.volume !== undefined ? { volume: options.volume } : {}),
      ...(options.onVolume ? { onVolume: options.onVolume } : {}),
    });
    effect(() => {
      const song = this.player.currentSong.value;
      this.nowCover.value = null;
      if (!song) return;
      void this.coverUrl(song).then((url) => {
        if (this.player.currentSong.peek() === song) this.nowCover.value = url;
      });
    });
  }

  /** Where the open folder's index is filed: its path, or its name where there is none (§3.2). */
  #root(source: LibrarySource): string {
    return source.where ?? source.name;
  }

  /** A URL for the song's cover, or null for the placeholder (§4.6). Never throws. */
  async coverUrl(song: Song): Promise<string | null> {
    const cover = song.cover;
    if (!cover) return null;
    try {
      if (cover.kind === 'embedded') return (await this.#index?.coverUrl(cover.id)) ?? null;
      const source = this.source.peek();
      const imageUrl = this.#imageUrl;
      if (!source || !imageUrl) return null;
      let url = this.#imageUrls.get(cover.path);
      if (!url) {
        const mime = cover.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        url = source.bytes(cover.path).then((bytes) => imageUrl(bytes, mime));
        this.#imageUrls.set(cover.path, url);
        // A failed read is tried again next time.
        url.catch(() => this.#imageUrls.delete(cover.path));
      }
      return await url;
    } catch {
      return null;
    }
  }

  /** Opens `source` in place of the folder open now: playback stops and the songs are read again. */
  async open(source: LibrarySource): Promise<void> {
    this.player.stop();
    batch(() => {
      this.source.value = source;
      this.songs.value = [];
      this.scanned.value = false;
      this.cursor.value = null;
    });
    this.#imageUrls = new Map();
    // The index from last time is shown at once; the scan then brings it up to date (§3.3).
    const saved = await this.#loadIndex(source);
    if (saved && this.source.peek() === source)
      batch(() => {
        this.songs.value = saved;
        this.cursor.value = saved[0]?.path ?? null;
      });
    await this.rescan();
  }

  async #loadIndex(source: LibrarySource): Promise<readonly Song[] | null> {
    try {
      return (await this.#index?.load(this.#root(source)))?.songs ?? null;
    } catch {
      // The index is only a cache: without it, the scan reads every file (§3.2).
      return null;
    }
  }

  /** Keeps the scan's songs and covers for next time, and deletes covers no song uses (§3.2). */
  async #saveIndex(source: LibrarySource, songs: readonly Song[]): Promise<void> {
    const index = this.#index;
    if (!index) return;
    try {
      await index.save(makeIndex(this.#root(source), songs, this.#now()));
      await index.pruneCovers(coverIds(songs));
    } catch (e) {
      this.say(`Couldn’t save the library index: ${e instanceof Error ? e.message : String(e)}`, {
        tone: 'error',
      });
    }
  }

  /** Reads the folder again, keeping songs whose files haven't changed (§3.3). */
  async rescan(): Promise<void> {
    const source = this.source.peek();
    if (!source) return;
    this.#scan?.abort();
    const scan = new AbortController();
    this.#scan = scan;
    this.scanning.value = { done: 0, total: 0 };
    const before = this.songs.peek();
    // What the scan has found so far, shown every SCAN_UPDATE_MS on top of what the list had (§3.3).
    const found = new Map(before.map((s) => [s.path, s]));
    let fresh = false;
    const stopUpdates = every(SCAN_UPDATE_MS, () => {
      if (!fresh || this.#scan !== scan) return;
      fresh = false;
      this.songs.value = sortSongs([...found.values()]);
      if (this.cursor.peek() === null) this.cursor.value = this.songs.peek()[0]?.path ?? null;
    });
    try {
      const songs = await scanLibrary(source, {
        previous: before,
        signal: scan.signal,
        onProgress: (p) => {
          if (this.#scan === scan) this.scanning.value = p;
        },
        onSong: (song) => {
          if (found.get(song.path) === song) return;
          found.set(song.path, song);
          fresh = true;
        },
        onCover: (id, picture) => this.#index?.saveCover(id, picture),
      });
      if (this.#scan !== scan) return;
      const moves = findMoves(before, songs);
      batch(() => {
        this.songs.value = songs;
        this.scanned.value = true;
        const cursor = this.cursor.peek();
        const moved = cursor === null ? undefined : moves.get(cursor);
        if (moved !== undefined) this.cursor.value = moved;
        else if (cursor === null || !this.byPath.peek().has(cursor))
          this.cursor.value = songs[0]?.path ?? null;
      });
      await this.#saveIndex(source, songs);
      const unreadable = songs.filter((s) => s.error).length;
      if (unreadable > 0)
        this.say(`${unreadable === 1 ? '1 file' : `${unreadable} files`} couldn’t be read.`, {
          tone: 'error',
          action: { label: 'Show', run: () => this.show('unreadable') },
        });
    } catch (e) {
      if (scan.signal.aborted) return;
      this.say(`Couldn’t read the music folder: ${e instanceof Error ? e.message : String(e)}`, {
        tone: 'error',
      });
    } finally {
      stopUpdates();
      if (this.#scan === scan) {
        this.#scan = null;
        this.scanning.value = null;
      }
    }
  }

  /** Open Music Folder… (§16.2, §17). */
  async openFolder(): Promise<void> {
    if (!this.folders) return;
    try {
      const source = await this.folders.choose();
      if (source) await this.open(source);
    } catch (e) {
      this.say(`Couldn’t open the folder: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
    }
  }

  /** Plays the song list from `path` (§8.2). */
  playPath(path: string): Promise<void> {
    const songs = this.songs.peek();
    const index = songs.findIndex((s) => s.path === path);
    if (index < 0) return Promise.resolve();
    this.cursor.value = path;
    return this.player.playFrom(
      songs.map((s) => s.path),
      index,
    );
  }

  /** Play/Pause: with nothing loaded, plays the list from the cursor, or from the top (§8.1). */
  playPause(): Promise<void> {
    if (this.player.state.peek() !== 'stopped') return this.player.toggle();
    const first = this.cursor.peek() ?? this.songs.peek().find((s) => !s.error)?.path;
    return first === undefined ? Promise.resolve() : this.playPath(first);
  }

  /** Shows a notice in the status bar and reads it out. */
  say(text: string, options: Omit<Notice, 'text'> = {}): void {
    this.#noticeTimer?.();
    const sticky = options.sticky ?? options.tone === 'error';
    this.notice.value = { text, ...options, sticky };
    this.announcement.value = text;
    this.#noticeTimer = sticky
      ? null
      : after(options.action ? NOTICE_ACTION_MS : NOTICE_MS, () => {
          this.notice.value = null;
        });
  }

  dismissNotice(): void {
    this.#noticeTimer?.();
    this.#noticeTimer = null;
    this.notice.value = null;
  }

  /** Opens a dialog; the one open now closes. */
  show(kind: DialogKind): void {
    this.dialog.value = kind;
  }

  close(): void {
    this.dialog.value = null;
  }

  /** True while a dialog has the keyboard, so list keys and plain-key commands wait. */
  blocked(): boolean {
    return this.dialog.value !== null;
  }
}
