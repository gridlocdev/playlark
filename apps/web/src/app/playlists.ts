/**
 * The playlists in the music folder (PRD §9): the list in the sidebar, the open playlists' entries, and every edit
 * to them as an undo step saved at once. Saves carry the version last read; a playlist changed elsewhere asks
 * Keep Mine or Use Theirs, and changes made elsewhere are picked up by `checkOutside` (§9.3).
 */
import { batch, computed, signal } from '@preact/signals';
import {
  EMPTY_PLAYLIST,
  addEntries,
  moveEntries,
  newPlaylistPath,
  parsePlaylist,
  playlistName,
  removeEntries,
  renamedPath,
  sameEntries,
  sha256Hex,
  unreadableSong,
  writePlaylist,
  type PlaylistEntry,
  type PlaylistFile,
  type Song,
} from '@playlark/core';
import { formatCount, wait, type LibrarySource, type PlaylistResult } from '@playlark/ui';
import type { Notice } from './notices.ts';
import type { UndoStack } from './undo.ts';

export interface PlaylistInfo {
  readonly path: string;
  readonly name: string;
}

/** The name a new playlist gets (§9.2). */
export const NEW_PLAYLIST = 'New Playlist';
/** How long a failed save waits before each retry (§9.3). */
export const SAVE_RETRIES_MS: readonly number[] = [300, 600];
/** Why playlists can't be edited in the browser-folder mode (§17). */
export const READ_ONLY = 'Edit tags and playlists in the desktop app or through the NAS server.';
/** The error a missing entry's row carries; its title is "Missing: <path>" (§9.1). */
export const MISSING = 'This song isn’t in the music folder.';

/** The row for an entry whose song isn't in the library: greyed, and skipped when played (§9.1). */
export function missingSong(entry: PlaylistEntry): Song {
  const path = entry.path ?? entry.raw;
  return {
    ...unreadableSong({ path, size: 0, mtime: 0 }, null, MISSING),
    title: `Missing: ${path}`,
    artist: '',
    album: '',
  };
}

const byName = (a: PlaylistInfo, b: PlaylistInfo) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) ||
  (a.path < b.path ? -1 : 1);
const info = (path: string): PlaylistInfo => ({ path, name: playlistName(path) });

/** An open playlist: what Playlark shows, what is on disk and its version. */
interface Open {
  readonly file: PlaylistFile;
  /** The entries as last read or saved; differs from `file` while a save is pending or failed. */
  readonly saved: PlaylistFile;
  /** The bytes last read or saved, so Undo of Delete Playlist can put them back. */
  readonly bytes: Uint8Array;
  readonly version: string;
}

export interface PlaylistsOptions {
  readonly source: () => LibrarySource | null;
  readonly songOf: (path: string) => Song | undefined;
  readonly undo: UndoStack;
  readonly say: (text: string, options?: Omit<Notice, 'text'>) => void;
  /** A playlist was renamed or deleted (null): the views showing it follow. */
  readonly moved: (from: string, to: string | null) => void;
}

export class Playlists {
  /** Every playlist in the folder, by name (§9.1). */
  readonly list = signal<readonly PlaylistInfo[]>([]);
  /** The entries of each playlist read so far. */
  readonly files = signal<ReadonlyMap<string, PlaylistFile>>(new Map());
  /** The playlist whose save found it changed elsewhere: "Keep Mine" or "Use Theirs" (§9.3). */
  readonly conflict = signal<string | null>(null);
  /** The playlist whose name field is showing in the sidebar. */
  readonly renaming = signal<string | null>(null);
  /** The playlist a right-click in the sidebar is about; the playlist commands act on it, else on the one shown. */
  readonly target = signal<string | null>(null);
  readonly editable = computed(() => !!this.#options.source()?.playlists);

  readonly #options: PlaylistsOptions;
  #open = new Map<string, Open>();
  readonly #saving = new Map<string, Promise<void>>();
  readonly #dirty = new Set<string>();

  constructor(options: PlaylistsOptions) {
    this.#options = options;
  }

  /** Another folder was opened. */
  reset(): void {
    this.#open = new Map();
    this.#dirty.clear();
    batch(() => {
      this.list.value = [];
      this.files.value = new Map();
      this.conflict.value = null;
      this.renaming.value = null;
      this.target.value = null;
    });
  }

  /** The playlists the folder listing found; ones read before keep their entries. */
  setPaths(paths: readonly string[]): void {
    const keep = new Set(paths);
    for (const p of this.#open.keys()) if (!keep.has(p) && !this.#dirty.has(p)) this.#open.delete(p);
    batch(() => {
      this.list.value = paths.map(info).sort(byName);
      this.#publish();
    });
  }

  nameOf(path: string): string {
    return playlistName(path);
  }

  has(path: string): boolean {
    return this.list.peek().some((p) => p.path === path);
  }

  /** The songs of a playlist's entries, a missing one as its placeholder (§9.1). */
  songsOf(path: string): Song[] {
    const file = this.files.value.get(path);
    if (!file) return [];
    return file.entries.map(
      (e) => (e.path === null ? undefined : this.#options.songOf(e.path)) ?? missingSong(e),
    );
  }

  /** Reads a playlist so its entries show; does nothing when it has been read. */
  async load(path: string): Promise<void> {
    if (this.#open.has(path)) return;
    const read = await this.#read(path).catch((e: unknown) => {
      this.#options.say(`Couldn’t read ${playlistName(path)}: ${message(e)}`, { tone: 'error' });
      return null;
    });
    if (read && !this.#open.has(path) && this.has(path)) {
      this.#open.set(path, read);
      this.#publish();
    }
  }

  /** New Playlist (⌘N, §9.2): with `songs`, named "New Playlist", its name field showing. Gives its path. */
  async create(songs: readonly string[], name = NEW_PLAYLIST): Promise<string | null> {
    if (!this.#canEdit()) return null;
    const path = newPlaylistPath(name, new Set(this.list.peek().map((p) => p.path)));
    const file = addEntries(EMPTY_PLAYLIST, path, songs);
    if (!(await this.#create(path, file))) return null;
    this.#options.undo.push({
      label: 'New Playlist',
      undo: async () => void (await this.#trash(path)),
      redo: async () => void (await this.#create(path, file)),
    });
    this.renaming.value = path;
    return path;
  }

  /** Add to Playlist (§9.2): at the end, duplicates allowed. */
  async add(path: string, songs: readonly string[]): Promise<void> {
    if (songs.length === 0) return;
    const done = await this.#edit(path, 'Add to Playlist', (f) => addEntries(f, path, songs));
    if (done)
      this.#options.say(
        `Added ${songs.length === 1 ? '1 song' : `${formatCount(songs.length)} songs`} to ${playlistName(path)}.`,
      );
  }

  /** Delete in a playlist (§9.2): takes the entries out; the songs' files stay. */
  async remove(path: string, indexes: readonly number[]): Promise<void> {
    await this.#edit(path, 'Remove from Playlist', (f) => removeEntries(f, indexes));
  }

  /** Dragging entries to the gap `to` (§9.2). */
  async move(path: string, indexes: readonly number[], to: number): Promise<void> {
    await this.#edit(path, 'Move in Playlist', (f) => moveEntries(f, indexes, to));
  }

  /** Rename (§9.2): the file gets the new name, in the same folder. */
  async rename(path: string, name: string): Promise<void> {
    this.renaming.value = null;
    if (!this.#canEdit() || name.trim() === '') return;
    const to = renamedPath(path, name, new Set(this.list.peek().map((p) => p.path)));
    if (to === path || !(await this.#move(path, to))) return;
    this.#options.undo.push({
      label: 'Rename Playlist',
      undo: async () => void (await this.#move(to, path)),
      redo: async () => void (await this.#move(path, to)),
    });
  }

  /** Delete Playlist (§9.2): the file goes to the trash, with Undo. */
  async delete(path: string): Promise<void> {
    if (!this.#canEdit()) return;
    await this.load(path);
    const open = this.#open.get(path);
    if (!open || !(await this.#trash(path))) return;
    this.#options.undo.push({
      label: 'Delete Playlist',
      undo: async () => void (await this.#restore(path, open)),
      redo: async () => void (await this.#trash(path)),
    });
    this.#options.say(`Deleted ${playlistName(path)}.`, {
      action: { label: 'Undo', run: () => void this.#options.undo.undo() },
    });
  }

  /** Keep Mine (§9.3): write Playlark's entries over the ones changed elsewhere. */
  async keepMine(): Promise<void> {
    const path = this.conflict.peek();
    const open = path === null ? undefined : this.#open.get(path);
    if (path === null || !open) return;
    this.conflict.value = null;
    const theirs = await this.#read(path).catch(() => null);
    this.#open.set(path, { ...open, version: theirs?.version ?? '' });
    await this.#save(path);
  }

  /** Use Theirs (§9.3): take the file as it is now, as one undo step. */
  async useTheirs(): Promise<void> {
    const path = this.conflict.peek();
    if (path === null) return;
    this.conflict.value = null;
    await this.#takeTheirs(path);
  }

  /**
   * Picks up changes made elsewhere to the playlists read so far (§9.3: when the window comes to the front and
   * every 15 s), each as one undo step.
   */
  async checkOutside(): Promise<void> {
    for (const path of [...this.#open.keys()]) {
      if (this.#saving.has(path) || this.#dirty.has(path) || this.conflict.peek() === path) continue;
      const open = this.#open.get(path)!;
      const theirs = await this.#read(path).catch(() => null);
      if (this.#saving.has(path) || this.#open.get(path) !== open) continue;
      if (theirs?.version === open.version) continue;
      if (open.file !== open.saved) this.conflict.value = path;
      else await this.#takeTheirs(path, theirs);
    }
  }

  async #takeTheirs(path: string, read?: Open | null): Promise<void> {
    const mine = this.#open.get(path);
    const theirs = read === undefined ? await this.#read(path).catch(() => null) : read;
    const name = playlistName(path);
    if (!theirs) {
      this.#drop(path);
      this.#options.say(`${name} was deleted somewhere else.`);
      return;
    }
    this.#open.set(path, theirs);
    this.#publish();
    if (mine && sameEntries(mine.file, theirs.file)) return;
    const before = mine?.file ?? EMPTY_PLAYLIST;
    this.#options.undo.push({
      label: 'Changes Made Elsewhere',
      undo: () => this.#apply(path, before),
      redo: () => this.#apply(path, theirs.file),
    });
    this.#options.say(`Updated ${name} with changes made elsewhere.`);
  }

  /** Waits for every save under way (tests, and before the folder changes). */
  async settled(): Promise<void> {
    while (this.#saving.size > 0) await Promise.all(this.#saving.values());
  }

  #canEdit(): boolean {
    if (this.editable.peek()) return true;
    this.#options.say(READ_ONLY);
    return false;
  }

  async #edit(path: string, label: string, change: (f: PlaylistFile) => PlaylistFile): Promise<boolean> {
    if (!this.#canEdit()) return false;
    await this.load(path);
    const before = this.#open.get(path)?.file;
    if (!before) return false;
    const after = change(before);
    if (after === before) return false;
    this.#options.undo.push({
      label,
      undo: () => this.#apply(path, before),
      redo: () => this.#apply(path, after),
    });
    // The list changes at once; the save follows, and says so itself if it fails (§9.3).
    void this.#apply(path, after);
    return true;
  }

  async #apply(path: string, file: PlaylistFile): Promise<void> {
    const open = this.#open.get(path);
    if (!open) return;
    this.#open.set(path, { ...open, file });
    this.#publish();
    await this.#save(path);
  }

  #publish(): void {
    this.files.value = new Map([...this.#open].map(([p, o]) => [p, o.file]));
  }

  async #read(path: string): Promise<Open> {
    const source = this.#options.source();
    if (!source) throw new Error('No music folder is open.');
    const bytes = new Uint8Array(await source.bytes(path));
    const root = source.kind === 'desktop' ? source.where : undefined;
    const file = parsePlaylist(bytes, path, root, (p) => this.#options.songOf(p) !== undefined);
    return { file, saved: file, bytes, version: sha256Hex(bytes) };
  }

  #bytesOf(path: string, file: PlaylistFile): Uint8Array {
    return writePlaylist(file, path, this.#options.songOf);
  }

  /** Saves the playlist; edits made while a save is under way are saved right after it. */
  #save(path: string): Promise<void> {
    this.#dirty.add(path);
    const running = this.#saving.get(path);
    if (running) return running;
    const run = (async () => {
      while (this.#dirty.has(path)) {
        this.#dirty.delete(path);
        await this.#write(path);
      }
    })().finally(() => this.#saving.delete(path));
    this.#saving.set(path, run);
    return run;
  }

  async #write(path: string): Promise<void> {
    const writer = this.#options.source()?.playlists;
    const open = this.#open.get(path);
    if (!writer || !open) return;
    const file = open.file;
    const bytes = this.#bytesOf(path, file);
    for (const delay of [0, ...SAVE_RETRIES_MS]) {
      if (delay > 0) await wait(delay);
      const r = await call(() => writer.write(path, bytes, open.version === '' ? null : open.version));
      if (this.#open.get(path)?.version !== open.version) return;
      if (r.ok) {
        this.#open.set(path, { ...this.#open.get(path)!, saved: file, bytes, version: r.version });
        return;
      }
      if (r.code === 'changed' || r.code === 'deleted' || r.code === 'exists') {
        this.conflict.value = path;
        return;
      }
    }
    this.#options.say(`Couldn’t save ${playlistName(path)}.`, {
      tone: 'error',
      action: { label: 'Try Again', run: () => void this.#save(path) },
    });
  }

  async #create(path: string, file: PlaylistFile): Promise<boolean> {
    const writer = this.#options.source()?.playlists;
    if (!writer) return false;
    const bytes = this.#bytesOf(path, file);
    const r = await call(() => writer.write(path, bytes, null));
    if (!r.ok) {
      this.#options.say(`Couldn’t make ${playlistName(path)}: ${r.message}`, { tone: 'error' });
      return false;
    }
    this.#open.set(path, { file, saved: file, bytes, version: r.version });
    this.#add(path);
    return true;
  }

  /** Puts a deleted playlist back with the bytes it had (Undo of Delete Playlist). */
  async #restore(path: string, open: Open): Promise<boolean> {
    const writer = this.#options.source()?.playlists;
    if (!writer) return false;
    const r = await call(() => writer.write(path, open.bytes, null));
    if (!r.ok) {
      this.#options.say(`Couldn’t put ${playlistName(path)} back: ${r.message}`, { tone: 'error' });
      return false;
    }
    this.#open.set(path, { ...open, version: r.version });
    this.#add(path);
    return true;
  }

  async #trash(path: string): Promise<boolean> {
    const writer = this.#options.source()?.playlists;
    await this.settled();
    const open = this.#open.get(path);
    if (!writer || !open) return false;
    const r = await call(() => writer.trash(path, open.version));
    if (!r.ok) {
      if (r.code === 'changed') this.conflict.value = path;
      else this.#options.say(`Couldn’t delete ${playlistName(path)}: ${r.message}`, { tone: 'error' });
      return false;
    }
    this.#drop(path);
    return true;
  }

  async #move(from: string, to: string): Promise<boolean> {
    const writer = this.#options.source()?.playlists;
    await this.settled();
    const open = this.#open.get(from) ?? (await this.#read(from).catch(() => null));
    if (!writer || !open) return false;
    const r = await call(() => writer.rename(from, to));
    if (!r.ok) {
      this.#options.say(`Couldn’t rename ${playlistName(from)}: ${r.message}`, { tone: 'error' });
      return false;
    }
    this.#open.delete(from);
    this.#open.set(to, open);
    batch(() => {
      this.list.value = [...this.list.peek().filter((p) => p.path !== from), info(to)].sort(byName);
      this.#publish();
      this.#options.moved(from, to);
    });
    return true;
  }

  #add(path: string): void {
    batch(() => {
      if (!this.has(path)) this.list.value = [...this.list.peek(), info(path)].sort(byName);
      this.#publish();
    });
  }

  #drop(path: string): void {
    this.#open.delete(path);
    this.#dirty.delete(path);
    batch(() => {
      this.list.value = this.list.peek().filter((p) => p.path !== path);
      if (this.conflict.peek() === path) this.conflict.value = null;
      this.#publish();
      this.#options.moved(path, null);
    });
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A write that threw (the bridge went away) counts as a failed one, so it is retried and reported. */
async function call(write: () => Promise<PlaylistResult>): Promise<PlaylistResult> {
  try {
    return await write();
  } catch (e) {
    return { ok: false, code: 'failed', message: message(e) };
  }
}
