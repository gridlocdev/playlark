/**
 * The window's state as signals: the music folder and its songs, the scan, the cursor in the song list, the open
 * dialog and the status-bar notice. Components read these; commands call the methods.
 */
import { batch, computed, signal } from '@preact/signals';
import { scanLibrary, type ScanProgress, type Song } from '@playlark/core';
import { Player, after, type AudioEngine, type LibrarySource } from '@playlark/ui';

export type DialogKind = 'commands' | 'shortcuts';

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
  readonly player: Player;

  #noticeTimer: (() => void) | null = null;
  #scan: AbortController | null = null;

  constructor(options: ControllerOptions) {
    this.version = options.version;
    this.folders = options.folders;
    this.cannotOpen = options.cannotOpen;
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
    await this.rescan();
  }

  /** Reads the folder again, keeping songs whose files haven't changed (§3.3). */
  async rescan(): Promise<void> {
    const source = this.source.peek();
    if (!source) return;
    this.#scan?.abort();
    const scan = new AbortController();
    this.#scan = scan;
    this.scanning.value = { done: 0, total: 0 };
    try {
      const songs = await scanLibrary(source, {
        previous: this.songs.peek(),
        signal: scan.signal,
        onProgress: (p) => {
          if (this.#scan === scan) this.scanning.value = p;
        },
      });
      if (this.#scan !== scan) return;
      batch(() => {
        this.songs.value = songs;
        this.scanned.value = true;
        const cursor = this.cursor.peek();
        if (cursor === null || !this.byPath.peek().has(cursor)) this.cursor.value = songs[0]?.path ?? null;
      });
      const unreadable = songs.filter((s) => s.error).length;
      if (unreadable > 0)
        this.say(`${unreadable === 1 ? '1 file' : `${unreadable} files`} couldn’t be read.`, {
          tone: 'error',
        });
    } catch (e) {
      if (scan.signal.aborted) return;
      this.say(`Couldn’t read the music folder: ${e instanceof Error ? e.message : String(e)}`, {
        tone: 'error',
      });
    } finally {
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
