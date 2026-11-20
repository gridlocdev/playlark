/**
 * The window's state as signals: the music folder and its songs, the scan, the cursor in the song list, the open
 * dialog and the status-bar notice. Components read these; commands call the methods.
 */
import { batch, computed, signal } from '@preact/signals';
import {
  buildLibrary,
  findMoves,
  fold,
  isPlaylistPath,
  prepareSearch,
  scanLibrary,
  search,
  sortSongs,
  songsUnder,
  type CoverRef,
  type ScanProgress,
  type Song,
  type SongColumn,
} from '@playlark/core';
import {
  Player,
  debounce,
  every,
  type AudioEngine,
  type IndexStore,
  type LibrarySource,
  type PlaybackSettings,
} from '@playlark/ui';
import { Covers } from './covers.ts';
import { loadIndexSongs, saveIndexSongs } from './libraryIndex.ts';
import { Notices, type Notice } from './notices.ts';
import { MISSING, Playlists } from './playlists.ts';
import { QueueKeeper, goneNotice } from './queueKeeper.ts';
import { NO_SELECTION, keep, only, selectedRows, type Selection } from './selection.ts';
import { Stats } from './stats.ts';
import { UndoStack } from './undo.ts';
import { viewRows, type SongOrder } from './viewRows.ts';
import {
  SONGS,
  back,
  forward,
  go,
  playlistMoved,
  replace,
  startHistory,
  type History,
  type View,
} from './views.ts';

export type DialogKind = 'commands' | 'shortcuts' | 'unreadable' | 'addToPlaylist';

/** How often the song list takes in what a scan has found so far (PRD §3.3). */
export const SCAN_UPDATE_MS = 500;
/** How long typing in the search field pauses before the results update (§6.4). */
export const SEARCH_IDLE_MS = 100;

export type { SongOrder } from './viewRows.ts';

/** A playlist row's key: its entry's place and its song, since a playlist may hold a song twice (§9.2). */
const entryKey = (index: number, path: string) => `${index}\0${path}`;
/** The song path a row key names. */
export const keyPath = (key: string): string => key.slice(key.indexOf('\0') + 1);

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
  /** ReplayGain and crossfade (§8.6, §8.7). */
  readonly playback?: () => PlaybackSettings;
  /** A seed for each shuffle; tests pin it. */
  readonly seed?: () => number;
  /** Where the index and its covers are kept between runs (§3.2). Absent: nothing is kept. */
  readonly index?: IndexStore;
  /** A URL an `<img>` can show for bytes read from the folder (a folder's cover image). */
  readonly imageUrl?: (bytes: ArrayBuffer, mime: string) => string;
  /** Today, for the index's scan date and the stats' times. */
  readonly now?: () => Date;
  /** A clock in ms that only goes forward, for how long a song was heard (§10.2); tests pin it. */
  readonly clock?: () => number;
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
  readonly rows = computed<readonly Song[]>(() =>
    viewRows(this.view.value, {
      library: this.library.value,
      order: this.songOrder.value,
      results: () => this.results.value,
      playlist: (path) => this.playlists.songsOf(path),
      stats: () => this.stats.songs.value,
      now: () => this.#now().getTime(),
    }),
  );
  /**
   * Each row's key, what the selection holds: the song's path, or in a playlist the entry's place and path.
   */
  readonly rowKeys = computed(() => {
    const paths = this.rows.value.map((s) => s.path);
    return this.view.value.kind === 'playlist' ? paths.map((p, i) => entryKey(i, p)) : paths;
  });
  readonly #rowIndex = computed(() => new Map(this.rowKeys.value.map((k, i) => [k, i])));
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
  readonly #notices = new Notices();
  readonly notice = this.#notices.notice;
  /** Read out by the status bar's live region. */
  readonly announcement = this.#notices.announcement;
  readonly dialog = signal<DialogKind | null>(null);
  readonly queueShown = signal(false);
  /** The Up Next entry the queue panel's cursor is on (an index in the queue), or null. */
  readonly queueCursor = signal<number | null>(null);
  /** The queue panel's list has the keyboard, so Delete removes from it. */
  readonly queueFocused = signal(false);
  /** The song list's right-click menu, where it was opened. */
  readonly menu = signal<{ readonly x: number; readonly y: number } | null>(null);
  /** Cover URLs worked out so far, by cover; null: none could be made. */
  /** The playing song's cover, as a URL, or null for the placeholder (§4.6). */
  readonly nowCover = computed(() => this.coverOf(this.player.currentSong.value?.cover));
  readonly player: Player;
  /** Undo and Redo (§9.2). */
  readonly undo = new UndoStack();
  readonly playlists: Playlists;
  /** Favourites and play counts (§10). */
  readonly stats: Stats;

  readonly #index: IndexStore | undefined;
  readonly #now: () => Date;
  #scan: AbortController | null = null;
  readonly #covers: Covers;
  readonly #queueKeeper: QueueKeeper;
  readonly #searching = debounce(SEARCH_IDLE_MS, () => this.#showSearch());

  constructor(options: ControllerOptions) {
    this.version = options.version;
    this.folders = options.folders;
    this.cannotOpen = options.cannotOpen;
    this.#index = options.index;
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
      ...(options.playback ? { playback: options.playback } : {}),
      ...(options.seed ? { seed: options.seed } : {}),
    });
    this.#covers = new Covers({
      index: options.index,
      imageUrl: options.imageUrl,
      source: () => this.source.value,
    });
    this.playlists = new Playlists({
      source: () => this.source.value,
      songOf: (path) => this.byPath.peek().get(path),
      undo: this.undo,
      say: (text, notice) => this.say(text, notice),
      moved: (from, to) => {
        this.history.value = playlistMoved(this.history.peek(), from, to);
      },
    });
    this.stats = new Stats({
      index: options.index,
      player: this.player,
      undo: this.undo,
      say: (text, notice) => this.say(text, notice),
      now: () => this.#now().getTime(),
      ...(options.clock ? { clock: options.clock } : {}),
    });
    this.#queueKeeper = new QueueKeeper({
      index: options.index,
      player: this.player,
      say: (text, tone) => this.say(text, tone ? { tone } : {}),
    });
  }

  /** Where the open folder's index is filed: its path, or its name where there is none (§3.2). */
  #root(source: LibrarySource): string {
    return source.where ?? source.name;
  }

  /** The URL for a cover, or null for the placeholder (§4.6). */
  coverOf(cover: CoverRef | undefined): string | null {
    return this.#covers.urlOf(cover);
  }

  /** Opens `source` in place of the folder open now: playback stops and the songs are read again. */
  async open(source: LibrarySource): Promise<void> {
    this.player.stop();
    this.#queueKeeper.reset();
    await this.playlists.settled();
    this.playlists.reset();
    this.undo.clear();
    batch(() => {
      this.source.value = source;
      this.songs.value = [];
      this.scanned.value = false;
      this.selection.value = NO_SELECTION;
      this.history.value = startHistory();
      this.searchText.value = '';
    });
    this.#covers.reset();
    await this.stats.open(this.#root(source));
    if (this.source.peek() !== source) return;
    // The index from last time is shown at once; the scan then brings it up to date (§3.3).
    const saved = await loadIndexSongs(this.#index, this.#root(source));
    if (saved && this.source.peek() === source) {
      this.#setSongs(saved);
      await this.#restoreQueue(source);
    }
    await this.rescan();
  }

  async #restoreQueue(source: LibrarySource): Promise<void> {
    await this.#queueKeeper.restore(this.#root(source), () => this.source.peek() === source);
  }

  /** Moves the seek bar, decodes ahead and counts plays (§10.2); the app calls it a few times a second. */
  tick(): void {
    this.player.tick();
    this.stats.sample();
  }

  /** Keeps the queue for next time (§8.4). The app calls it every second. */
  async keepQueue(): Promise<void> {
    const source = this.source.peek();
    if (source) await this.#queueKeeper.keep(this.#root(source));
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
      // One listing: the playlists for the sidebar (§9.1), the music files for the scan.
      const files = await source.list();
      if (this.#scan !== scan) return;
      this.playlists.setPaths(files.filter((f) => isPlaylistPath(f.path)).map((f) => f.path));
      const songs = await scanLibrary(
        { ...source, list: () => Promise.resolve(files) },
        {
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
        },
      );
      if (this.#scan !== scan) return;
      const moves = findMoves(before, songs);
      this.stats.scanned(songs, moves);
      batch(() => {
        const sel = this.selection.peek();
        const moved = sel.cursor === null ? undefined : moves.get(sel.cursor);
        this.#setSongs(songs);
        if (moved !== undefined && this.#rowIndex.peek().has(moved)) this.selection.value = only(moved);
        this.scanned.value = true;
      });
      const gone = this.player.prune();
      if (gone > 0) this.say(goneNotice(gone));
      await this.#restoreQueue(source);
      const failed = await saveIndexSongs(this.#index, this.#root(source), songs, this.#now());
      if (failed) this.say(`Couldn’t save the library index: ${failed}`, { tone: 'error' });
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
      const before = this.rowKeys.peek();
      this.songs.value = songs;
      const after = this.rowKeys.peek();
      const sel = keep(this.selection.peek(), before, after);
      this.selection.value = sel.cursor === null && after[0] !== undefined ? only(after[0]) : sel;
    });
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
    this.#opened(view);
  }

  /** A playlist's entries are read when it is first shown. */
  #opened(view: View): void {
    if (view.kind !== 'playlist') return;
    void this.playlists.load(view.path).then(() => {
      if (this.view.peek() === view && this.selection.peek().cursor === null) this.#selectFirst();
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
    this.#opened(to.current);
  }

  #selectFirst(): void {
    const first = this.rowKeys.peek()[0];
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

  /**
   * Replaces the queue with `songs`, leaving out the ones that can't be read (and a playlist's missing entries,
   * §9.1), from the song at index `start` (§8.2).
   */
  playSongs(songs: readonly Song[], start = 0): Promise<void> {
    const playable = songs.filter((s, i) => !s.error || (i === start && s.error !== MISSING));
    const index = songs.slice(0, start).filter((s) => !s.error).length;
    if (playable.length === 0) return Promise.resolve();
    return this.player.playFrom(
      playable.map((s) => s.path),
      Math.min(index, playable.length - 1),
    );
  }

  /** The Shuffle buttons (§8.2): every readable song in `songs`, in a random order. */
  shuffleSongs(songs: readonly Song[]): Promise<void> {
    const playable = songs.filter((s) => !s.error).map((s) => s.path);
    return playable.length === 0 ? Promise.resolve() : this.player.shuffleAll(playable);
  }

  /** The selected rows' places in the view (or the cursor's), in shown order. */
  selectedIndexes(): number[] {
    const at = this.#rowIndex.peek();
    return selectedRows(this.selection.peek(), this.rowKeys.peek()).map((k) => at.get(k)!);
  }

  /** The songs the Song commands act on: the selection, or the cursor's song; never a missing entry. */
  selectedSongs(): Song[] {
    const rows = this.rows.peek();
    return this.selectedIndexes().flatMap((i) => (rows[i]!.error === MISSING ? [] : [rows[i]!]));
  }

  /** Plays the view's songs from the row `key` (§8.2, a double-click). */
  playRow(key: string): Promise<void> {
    const at = this.#rowIndex.peek().get(key);
    if (at === undefined) return Promise.resolve();
    this.selection.value = only(key);
    return this.playSongs(this.rows.peek(), at);
  }

  /** Play (Return): several songs selected play just those; one plays the view from it (§8.2). */
  playSelection(): Promise<void> {
    const picked = this.selectedIndexes();
    const rows = this.rows.peek();
    if (picked.length > 1) return this.playSongs(picked.map((i) => rows[i]!));
    return picked[0] === undefined ? Promise.resolve() : this.playSongs(rows, picked[0]);
  }

  /** Play/Pause: with nothing loaded, plays the view from the cursor, or from the top (§8.1). */
  playPause(): Promise<void> {
    if (this.player.state.peek() !== 'stopped') return this.player.toggle();
    if (this.rows.peek().length === 0) return this.playSongs(this.library.peek().songs);
    const cursor = this.cursor.peek();
    return this.playSongs(this.rows.peek(), (cursor === null ? 0 : this.#rowIndex.peek().get(cursor)) ?? 0);
  }

  /** The song the Song commands act on: the cursor's. */
  focusedSong(): Song | undefined {
    const cursor = this.cursor.peek();
    return cursor === null ? undefined : this.byPath.peek().get(keyPath(cursor));
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
    if (this.#keyOf(path) === undefined) this.navigate(SONGS);
    this.#select(path);
  }

  /** The first row showing the song at `path`. */
  #keyOf(path: string): string | undefined {
    return this.rowKeys.peek().find((k) => keyPath(k) === path);
  }

  #select(path: string): void {
    const key = this.#keyOf(path);
    if (key !== undefined) this.selection.value = only(key);
  }

  /** The folder's songs and everything under it (§6.2 Folders: Play). */
  folderSongs(path: string): Song[] {
    const folder = this.library.peek().folderByPath.get(path);
    return folder ? songsUnder(folder) : [];
  }

  /** Shows a notice in the status bar and reads it out. */
  say(text: string, options: Omit<Notice, 'text'> = {}): void {
    this.#notices.say(text, options);
  }

  dismissNotice(): void {
    this.#notices.dismiss();
  }

  /** Undo (⌘Z) and Redo (⇧⌘Z, §9.2). */
  async undoStep(redo = false): Promise<void> {
    try {
      const label = await (redo ? this.undo.redo() : this.undo.undo());
      if (label) this.say(`${redo ? 'Redo' : 'Undo'} ${label}`);
    } catch (e) {
      this.say(`Couldn’t ${redo ? 'redo' : 'undo'}: ${e instanceof Error ? e.message : String(e)}`, {
        tone: 'error',
      });
    }
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
    return this.dialog.value !== null || this.playlists.conflict.value !== null;
  }
}
