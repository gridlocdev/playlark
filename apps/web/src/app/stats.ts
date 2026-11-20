/**
 * Favourites and play counts for the open folder (PRD §10): the heart toggles with Undo, a play counts once per
 * start after half the song or 4 minutes heard, and everything is written to the index store at most every 2 s.
 */
import { signal } from '@preact/signals';
import {
  NO_STATS,
  listen,
  moveStats,
  noteAdded,
  type FolderStats,
  type Listening,
  type Song,
  type SongStats,
} from '@playlark/core';
import type { IndexStore, Player } from '@playlark/ui';
import type { Notice } from './notices.ts';
import type { UndoStack } from './undo.ts';

/** How often changed stats are written (§10.1). */
export const SAVE_STATS_MS = 2_000;

export interface StatsOptions {
  readonly index: IndexStore | undefined;
  readonly player: Player;
  readonly undo: UndoStack;
  readonly say: (text: string, notice?: Omit<Notice, 'text'>) => void;
  /** The time, in ms since 1970: what `lastPlayed` and `added` hold. */
  readonly now: () => number;
  /** A clock in ms that only goes forward, for how long a song was heard. */
  readonly clock?: () => number;
}

export class Stats {
  /** The open folder's stats, by song path. */
  readonly songs = signal<FolderStats>(new Map());
  readonly #options: StatsOptions;
  #root: string | null = null;
  /** The stored stats were read (or there were none), so writing them loses nothing. */
  #writable = false;
  /** Nothing was stored for this folder: its first scan dates songs by their files (§6.2). */
  #fresh = false;
  #dirty = false;
  #failed = false;
  #listening: Listening | null = null;
  #saving: Promise<void> = Promise.resolve();

  constructor(options: StatsOptions) {
    this.#options = options;
  }

  get(path: string): SongStats {
    return this.songs.value.get(path) ?? NO_STATS;
  }

  /** Reads the stats kept for the folder at `root`, after writing out the last folder's. */
  async open(root: string): Promise<void> {
    await this.flush();
    this.#root = root;
    this.#listening = null;
    this.#dirty = false;
    this.#failed = false;
    this.songs.value = new Map();
    const index = this.#options.index;
    if (!index) {
      this.#writable = false;
      return;
    }
    try {
      const stats = await index.loadStats(root);
      if (this.#root !== root) return;
      this.songs.value = stats;
      this.#fresh = stats.size === 0;
      this.#writable = true;
    } catch (e) {
      this.#writable = false;
      this.#options.say(`Favourites and play counts won’t be kept: ${message(e)}`, { tone: 'error' });
    }
  }

  /** After a scan: moved songs keep their stats (§3.3), and new songs are dated for Recently Added. */
  scanned(songs: readonly Song[], moves: ReadonlyMap<string, string>): void {
    const before = this.songs.peek();
    const after = noteAdded(moveStats(before, moves), songs, this.#options.now(), this.#fresh);
    this.#fresh = false;
    if (after !== before) this.#set(after);
  }

  /** Favourite (⌥⌘F, §10.2): on for all when any is off, else off for all; an undo step. */
  toggleFavourite(paths: readonly string[]): void {
    if (paths.length === 0) return;
    const was = new Map(paths.map((p) => [p, this.get(p).favourite]));
    const on = [...was.values()].some((f) => !f);
    const set = (value: (path: string) => boolean) => {
      const next = new Map(this.songs.peek());
      for (const p of paths) next.set(p, { ...(next.get(p) ?? NO_STATS), favourite: value(p) });
      this.#set(next);
    };
    set(() => on);
    this.#options.undo.push({
      label: on ? 'Favourite' : 'Unfavourite',
      undo: () => set((p) => was.get(p)!),
      redo: () => set(() => on),
    });
  }

  /** Counts a play of `path` (§10.2). */
  played(path: string): void {
    const s = this.songs.peek().get(path) ?? NO_STATS;
    const next = new Map(this.songs.peek());
    next.set(path, { ...s, plays: s.plays + 1, lastPlayed: this.#options.now() });
    this.#set(next);
  }

  /** Looks at the player; the app calls it a few times a second. A song heard long enough counts once. */
  sample(): void {
    const p = this.#options.player;
    const path = p.currentPath.peek();
    if (path === undefined) {
      this.#listening = null;
      return;
    }
    const { listening, count } = listen(this.#listening, {
      play: p.started.peek(),
      playing: p.state.peek() === 'playing',
      now: (this.#options.clock ?? (() => performance.now()))(),
      duration: p.duration.peek(),
    });
    this.#listening = listening;
    if (count) this.played(path);
  }

  /** Writes the stats if they changed (§10.1); the app calls it every 2 s and when the page goes away. */
  flush(): Promise<void> {
    this.#saving = this.#saving.then(() => this.#write());
    return this.#saving;
  }

  async #write(): Promise<void> {
    const index = this.#options.index;
    const root = this.#root;
    if (!this.#dirty || !this.#writable || !index || root === null) return;
    this.#dirty = false;
    try {
      await index.saveStats(root, this.songs.peek());
      this.#failed = false;
    } catch (e) {
      if (this.#root === root) this.#dirty = true;
      if (!this.#failed)
        this.#options.say(`Couldn’t save favourites and play counts: ${message(e)}`, { tone: 'error' });
      this.#failed = true;
    }
  }

  #set(stats: FolderStats): void {
    this.songs.value = stats;
    this.#dirty = true;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
