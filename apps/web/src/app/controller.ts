/**
 * The window's state as signals: the music folder and its songs, the scan, the cursor in the song list, the open
 * dialog and the status-bar notice. Components read these; commands call the methods.
 */
import { batch, computed, signal } from '@preact/signals';
import {
  buildLibrary,
  coverIds,
  findMoves,
  fold,
  makeIndex,
  prepareSearch,
  scanLibrary,
  search,
  sortSongs,
  sortSongsBy,
  songsUnder,
  type CoverRef,
  type ScanProgress,
  type Song,
  type SongColumn,
} from '@playlark/core';
import {
  Player,
  after,
  debounce,
  every,
  type AudioEngine,
  type IndexStore,
  type LibrarySource,
} from '@playlark/ui';
import { NO_SELECTION, keep, only, selectedRows, type Selection } from './selection.ts';
import { SONGS, back, forward, go, replace, startHistory, type History, type View } from './views.ts';

export type DialogKind = 'commands' | 'shortcuts' | 'unreadable';

/** How often the song list takes in what a scan has found so far (PRD §3.3). */
export const SCAN_UPDATE_MS = 500;
/** How long typing in the search field pauses before the results update (§6.4). */
export const SEARCH_IDLE_MS = 100;

/** The Songs table's order: a column, or null for the default (§6.2). */
export interface SongOrder {
  readonly column: SongColumn | null;
  readonly reverse: boolean;
}

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
  /** Albums, artists and folders (§4.4). */
  readonly library = computed(() => buildLibrary(this.songs.value));
  readonly searchIndex = computed(() => prepareSearch(this.library.value));
  readonly history = signal<History>(startHistory());
  readonly view = computed(() => this.history.value.current);
  readonly songOrder = signal<SongOrder>({ column: null, reverse: false });
  /** What the search field holds; the search view follows it after a pause (§6.4). */
  readonly searchText = signal('');
  readonly results = computed(() => {
    const view = this.view.value;
    return view.kind === 'search' ? search(this.searchIndex.value, view.query) : null;
  });
  /** The songs the current view lists, in their shown order: what Play, the keys and Select All work on. */
  readonly rows = computed<readonly Song[]>(() => this.#rowsOf(this.view.value));
  readonly rowPaths = computed(() => this.rows.value.map((s) => s.path));
  readonly selection = signal<Selection>(NO_SELECTION);
  /** The song the list's cursor is on. */
  readonly cursor = computed(() => this.selection.value.cursor);
  readonly sidebarShown = signal(true);
  /** The search field, so Find can put the keyboard there. Set by the toolbar. */
  readonly searchField: { current: HTMLInputElement | null } = { current: null };
  /** The scan under way, or null. */
  readonly scanning = signal<ScanProgress | null>(null);
  /** True once the first scan of the open folder has finished. */
  readonly scanned = signal(false);
  readonly notice = signal<Notice | null>(null);
  /** Read out by the status bar's live region. */
  readonly announcement = signal('');
  readonly dialog = signal<DialogKind | null>(null);
  readonly queueShown = signal(false);
  /** Cover URLs worked out so far, by cover; null: none could be made. */
  readonly #covers = signal<ReadonlyMap<string, string | null>>(new Map());
  readonly #coverLoads = new Set<string>();
  /** The playing song's cover, as a URL, or null for the placeholder (§4.6). */
  readonly nowCover = computed(() => this.coverOf(this.player.currentSong.value?.cover));
  readonly player: Player;

  readonly #index: IndexStore | undefined;
  readonly #imageUrl: ((bytes: ArrayBuffer, mime: string) => string) | undefined;
  readonly #now: () => Date;
  #noticeTimer: (() => void) | null = null;
  #scan: AbortController | null = null;
  readonly #searching = debounce(SEARCH_IDLE_MS, () => this.#showSearch());

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
  }

  /** Where the open folder's index is filed: its path, or its name where there is none (§3.2). */
  #root(source: LibrarySource): string {
    return source.where ?? source.name;
  }

  /**
   * The URL for a cover, or null for the placeholder (§4.6). The first call for a cover starts working it out
   * and returns null; the signal redraws whoever asked once it is ready.
   */
  coverOf(cover: CoverRef | undefined): string | null {
    if (!cover) return null;
    const key = cover.kind === 'embedded' ? `id:${cover.id}` : `file:${cover.path}`;
    const known = this.#covers.value.get(key);
    if (known !== undefined) return known;
    if (!this.#coverLoads.has(key)) {
      this.#coverLoads.add(key);
      void this.#coverUrl(cover).then((url) => {
        this.#coverLoads.delete(key);
        this.#covers.value = new Map(this.#covers.peek()).set(key, url);
      });
    }
    return null;
  }

  /** Never throws: a cover that can't be read is the placeholder. */
  async #coverUrl(cover: CoverRef): Promise<string | null> {
    try {
      if (cover.kind === 'embedded') return (await this.#index?.coverUrl(cover.id)) ?? null;
      const source = this.source.peek();
      const imageUrl = this.#imageUrl;
      if (!source || !imageUrl) return null;
      const mime = cover.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      return imageUrl(await source.bytes(cover.path), mime);
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
      this.selection.value = NO_SELECTION;
      this.history.value = startHistory();
      this.searchText.value = '';
      this.#covers.value = new Map();
    });
    // The index from last time is shown at once; the scan then brings it up to date (§3.3).
    const saved = await this.#loadIndex(source);
    if (saved && this.source.peek() === source) this.#setSongs(saved);
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
      this.#setSongs(sortSongs([...found.values()]));
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
        const sel = this.selection.peek();
        const moved = sel.cursor === null ? undefined : moves.get(sel.cursor);
        this.#setSongs(songs);
        if (moved !== undefined && this.rowPaths.peek().includes(moved)) this.selection.value = only(moved);
        this.scanned.value = true;
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

  /** Puts the songs in place and keeps the selection to the rows still shown (§6.3). */
  #setSongs(songs: readonly Song[]): void {
    batch(() => {
      const before = this.rowPaths.peek();
      this.songs.value = songs;
      const after = this.rowPaths.peek();
      const sel = keep(this.selection.peek(), before, after);
      this.selection.value = sel.cursor === null && after[0] !== undefined ? only(after[0]) : sel;
    });
  }

  #rowsOf(view: View): readonly Song[] {
    const lib = this.library.value;
    switch (view.kind) {
      case 'songs': {
        const order = this.songOrder.value;
        return order.column === null && !order.reverse
          ? lib.songs
          : sortSongsBy(lib.songs, order.column, order.reverse);
      }
      case 'album':
        return lib.albumByKey.get(view.key)?.songs ?? [];
      case 'artist': {
        const artist = lib.artistByKey.get(view.key);
        if (!artist) return [];
        const theirs = (songs: readonly Song[]) => songs.filter((s) => fold(s.artist) === artist.key);
        return [
          ...artist.albums.flatMap((a) => a.songs),
          ...artist.appearsOn.flatMap((a) => theirs(a.songs)),
        ];
      }
      case 'folders':
        return lib.folderByPath.get(view.path)?.songs ?? [];
      case 'search':
        return this.results.value?.songs ?? [];
      case 'albums':
      case 'artists':
        return [];
    }
  }

  /** Opens `view` (§6.1). The cursor goes to its first song. */
  navigate(view: View): void {
    batch(() => {
      if (view.kind !== 'search') {
        this.#searching.cancel();
        this.searchText.value = '';
      }
      this.history.value = go(this.history.peek(), view);
      this.#selectFirst();
    });
  }

  goBack(): void {
    this.#walk(back(this.history.peek()));
  }

  goForward(): void {
    this.#walk(forward(this.history.peek()));
  }

  #walk(to: History): void {
    batch(() => {
      this.#searching.cancel();
      this.history.value = to;
      this.searchText.value = to.current.kind === 'search' ? to.current.query : '';
      this.#selectFirst();
    });
  }

  #selectFirst(): void {
    const first = this.rowPaths.peek()[0];
    this.selection.value = first === undefined ? NO_SELECTION : only(first);
  }

  /** Clicking a column header: sort by it, or reverse it (§6.2). */
  sortBy(column: SongColumn): void {
    const order = this.songOrder.peek();
    this.songOrder.value =
      order.column === column ? { column, reverse: !order.reverse } : { column, reverse: false };
  }

  /** Typing in the search field (§6.4): the results follow after a pause; an empty field goes back. */
  setSearch(text: string): void {
    this.searchText.value = text;
    this.#searching.call();
  }

  #showSearch(): void {
    const query = this.searchText.peek().trim();
    const h = this.history.peek();
    const inSearch = h.current.kind === 'search';
    if (!query) {
      if (inSearch) this.#walk(back(h));
      return;
    }
    batch(() => {
      const view: View = { kind: 'search', query };
      this.history.value = inSearch ? replace(h, view) : go(h, view);
      this.#selectFirst();
    });
  }

  /** Escape in the search field: empty it and go back to the view before the search (§6.4). */
  clearSearch(): void {
    this.#searching.cancel();
    this.searchText.value = '';
    if (this.history.peek().current.kind === 'search') this.#walk(back(this.history.peek()));
  }

  focusSearch(): void {
    this.searchField.current?.focus();
    this.searchField.current?.select();
  }

  /** Replaces the queue with `songs`, leaving out the ones that can't be read, from `start` (§8.2). */
  playSongs(songs: readonly Song[], start?: string): Promise<void> {
    const playable = songs.filter((s) => !s.error || s.path === start);
    const index =
      start === undefined
        ? 0
        : Math.max(
            0,
            playable.findIndex((s) => s.path === start),
          );
    if (playable.length === 0) return Promise.resolve();
    return this.player.playFrom(
      playable.map((s) => s.path),
      index,
    );
  }

  /** Plays the view's songs from `path` (§8.2, a double-click). */
  playPath(path: string): Promise<void> {
    if (!this.rowPaths.peek().includes(path)) return Promise.resolve();
    this.selection.value = only(path);
    return this.playSongs(this.rows.peek(), path);
  }

  /** Play (Return): several songs selected play just those; one plays the view from it (§8.2). */
  playSelection(): Promise<void> {
    const picked = selectedRows(this.selection.peek(), this.rowPaths.peek());
    if (picked.length > 1) {
      const byPath = this.byPath.peek();
      return this.playSongs(picked.map((p) => byPath.get(p)!));
    }
    return picked[0] === undefined ? Promise.resolve() : this.playSongs(this.rows.peek(), picked[0]);
  }

  /** Play/Pause: with nothing loaded, plays the view from the cursor, or from the top (§8.1). */
  playPause(): Promise<void> {
    if (this.player.state.peek() !== 'stopped') return this.player.toggle();
    const rows = this.rows.peek().length > 0 ? this.rows.peek() : this.library.peek().songs;
    const cursor = this.cursor.peek();
    return this.playSongs(rows, cursor !== null && rows.some((s) => s.path === cursor) ? cursor : undefined);
  }

  /** The song the Song commands act on: the cursor's. */
  focusedSong(): Song | undefined {
    const cursor = this.cursor.peek();
    return cursor === null ? undefined : this.byPath.peek().get(cursor);
  }

  goToAlbum(song: Song): void {
    const album = this.library.peek().albumOf.get(song.path);
    if (album) this.navigate({ kind: 'album', key: album.key });
    this.#select(song.path);
  }

  /** The song's artist's page if they have one, else its album artist's (§4.4). */
  goToArtist(song: Song): void {
    const artists = this.library.peek().artistByKey;
    const key = artists.has(fold(song.artist)) ? fold(song.artist) : fold(song.albumArtist);
    if (artists.has(key)) this.navigate({ kind: 'artist', key });
    this.#select(song.path);
  }

  /** Go to Current Song (⌘L): selects the playing song, in this view if it's here, else in Songs. */
  goToCurrent(): void {
    const path = this.player.currentPath.peek();
    if (path === undefined || !this.byPath.peek().has(path)) return;
    if (!this.rowPaths.peek().includes(path)) this.navigate(SONGS);
    this.#select(path);
  }

  #select(path: string): void {
    if (this.rowPaths.peek().includes(path)) this.selection.value = only(path);
  }

  /** The folder's songs and everything under it (§6.2 Folders: Play). */
  folderSongs(path: string): Song[] {
    const folder = this.library.peek().folderByPath.get(path);
    return folder ? songsUnder(folder) : [];
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
