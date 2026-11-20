/**
 * Song Info (PRD §11.1): the real tags of the selected songs, the fields the user changes, and the save that
 * writes only those fields into each file, one file at a time, as one undo step (§11.3).
 */
import { batch, computed, signal } from '@preact/signals';
import {
  EDIT_NUMBER_FIELDS,
  EDIT_TEXT_FIELDS,
  MAX_NUMBER,
  baseName,
  canEditFormat,
  readTags,
  type EditNumberField,
  type EditTextField,
  type Picture,
  type Song,
  type TagEdit,
  type Tags,
} from '@playlark/core';
import type { FileFacts, LibrarySource, TagWriter } from '@playlark/ui';
import type { UndoStack } from './undo.ts';

export type InfoField = EditTextField | EditNumberField;

/** One field as the dialog shows it: the text in the box, whether the songs disagree, whether it was changed. */
export interface FieldState {
  readonly value: string;
  readonly mixed: boolean;
  readonly changed: boolean;
}

/** The cover the songs have now: one picture, none, or different ones. */
export type CurrentCover = Picture | null | 'mixed';

/** Show "Saving 3 of 12…" above this many songs (§11.1). */
const SHOW_PROGRESS_ABOVE = 5;
/** How many files are read at once when the dialog opens. */
const READ_AT_ONCE = 4;

/** The fields a selection of several songs can't change (§11.1). */
export const ONE_SONG_FIELDS: ReadonlySet<InfoField> = new Set(['title', 'track']);

/** Where a source can't save tags (§11.5, §17). */
export const READ_ONLY_NOTE = 'Edit tags in the desktop app or through the NAS server.';

interface Loaded {
  readonly song: Song;
  readonly tags: Tags;
  readonly cover: Picture | null;
}

/** A file written by a save, and what to write to flip it back (or forward again). */
interface Written {
  readonly path: string;
  edit: TagEdit;
  file: FileFacts;
}

export interface TagEditorOptions {
  readonly source: () => LibrarySource | null;
  readonly undo: UndoStack;
  /** Reads the folder again so the list shows the new tags. */
  readonly refresh: () => Promise<void>;
  readonly close: () => void;
}

const sameCover = (a: Picture | null, b: Picture | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.data.length === b.data.length &&
    a.data.every((byte, i) => byte === b.data[i]));

/** The text a field shows for one song's tags. */
function fieldText(tags: Tags, field: InfoField): string {
  const v = tags[field];
  return v === undefined ? '' : String(v);
}

export class TagEditor {
  readonly songs = signal<readonly Song[]>([]);
  readonly loading = signal(false);
  readonly fields = signal<Readonly<Record<InfoField, FieldState>> | null>(null);
  readonly compilation = signal<{
    readonly value: boolean;
    readonly mixed: boolean;
    readonly changed: boolean;
  }>({ value: false, mixed: false, changed: false });
  readonly currentCover = signal<CurrentCover>(null);
  /** The cover the save will write: undefined keeps the current one, null takes it out. */
  readonly newCover = signal<Picture | null | undefined>(undefined);
  /** "Saving 3 of 12…" while a save of more than 5 songs runs. */
  readonly progress = signal<{ readonly done: number; readonly total: number } | null>(null);
  readonly saving = signal(false);
  /** One line per file a save or a read couldn't handle, and a field that isn't valid. */
  readonly errors = signal<readonly string[]>([]);
  /** Why nothing can be saved here, or null when the songs can be edited. */
  readonly readOnly = computed(() => {
    if (!this.#opts.source()?.tags) return READ_ONLY_NOTE;
    const formats = new Set(this.songs.value.map((s) => s.format));
    const editable = [...formats].some((f) => f !== null && canEditFormat(f));
    if (editable || this.songs.value.length === 0) return null;
    const [only] = [...formats];
    return only
      ? `Playlark can’t edit the tags of ${only.toUpperCase()} files yet.`
      : 'Playlark can’t edit these files.';
  });
  readonly #opts: TagEditorOptions;
  #loaded: readonly Loaded[] = [];
  #opened = 0;

  constructor(options: TagEditorOptions) {
    this.#opts = options;
  }

  /** Opens Song Info on `songs`, reading each one's tags from its file. */
  async open(songs: readonly Song[]): Promise<void> {
    const ticket = ++this.#opened;
    const readable = songs.filter((s) => !s.error);
    batch(() => {
      this.songs.value = readable;
      this.loading.value = true;
      this.fields.value = null;
      this.newCover.value = undefined;
      this.errors.value = [];
      this.progress.value = null;
      this.saving.value = false;
    });
    const source = this.#opts.source();
    const loaded: Loaded[] = [];
    const errors: string[] = [];
    let next = 0;
    const worker = async () => {
      while (next < readable.length) {
        const song = readable[next++]!;
        try {
          if (!source) throw new Error('No music folder is open.');
          const read = await readTags(await source.open(song), song.path);
          if (!read.ok) throw new Error(read.error);
          loaded.push({ song, tags: read.tags, cover: read.cover ?? null });
        } catch (e) {
          errors.push(`${baseName(song.path)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: READ_AT_ONCE }, worker));
    if (ticket !== this.#opened) return;
    const order = new Map(readable.map((s, i) => [s.path, i]));
    loaded.sort((a, b) => order.get(a.song.path)! - order.get(b.song.path)!);
    this.#loaded = loaded;
    batch(() => {
      this.songs.value = loaded.map((l) => l.song);
      this.fields.value = this.#startFields(loaded);
      const flags = new Set(loaded.map((l) => l.tags.compilation === true));
      this.compilation.value = {
        value: flags.has(true) && flags.size === 1,
        mixed: flags.size > 1,
        changed: false,
      };
      const first = loaded[0]?.cover ?? null;
      this.currentCover.value = loaded.every((l) => sameCover(l.cover, first)) ? first : 'mixed';
      this.errors.value = errors;
      this.loading.value = false;
    });
  }

  #startFields(loaded: readonly Loaded[]): Record<InfoField, FieldState> {
    const out = {} as Record<InfoField, FieldState>;
    for (const f of [...EDIT_TEXT_FIELDS, ...EDIT_NUMBER_FIELDS]) {
      const values = new Set(loaded.map((l) => fieldText(l.tags, f)));
      const mixed = values.size > 1;
      out[f] = { value: mixed ? '' : ([...values][0] ?? ''), mixed, changed: false };
    }
    return out;
  }

  /** True when the field can be changed for the songs open. */
  canChange(field: InfoField): boolean {
    return this.readOnly.value === null && !(this.songs.value.length > 1 && ONE_SONG_FIELDS.has(field));
  }

  setField(field: InfoField, value: string): void {
    const fields = this.fields.peek();
    if (!fields || !this.canChange(field)) return;
    this.fields.value = { ...fields, [field]: { value, mixed: fields[field].mixed, changed: true } };
  }

  setCompilation(value: boolean): void {
    this.compilation.value = { value, mixed: false, changed: true };
  }

  /** A new front cover (Choose Image…, Paste), or null to take the cover out (Remove). */
  setCover(picture: Picture | null): void {
    this.newCover.value = picture;
  }

  /** The edit the fields describe, or a message naming the first field that isn't valid. */
  edit(): TagEdit | string {
    const fields = this.fields.peek();
    if (!fields) return {};
    const out: Record<string, unknown> = {};
    for (const f of EDIT_TEXT_FIELDS) if (fields[f].changed) out[f] = fields[f].value;
    for (const f of EDIT_NUMBER_FIELDS) {
      if (!fields[f].changed) continue;
      const text = fields[f].value.trim();
      if (text === '') {
        out[f] = null;
        continue;
      }
      const n = Number(text);
      if (!/^\d+$/.test(text) || n < 1 || n > MAX_NUMBER)
        return `${FIELD_NAMES[f]} must be a whole number from 1 to ${MAX_NUMBER}.`;
      out[f] = n;
    }
    if (this.compilation.peek().changed) out['compilation'] = this.compilation.peek().value;
    if (this.newCover.peek() !== undefined) out['cover'] = this.newCover.peek();
    return out as TagEdit;
  }

  /** Save: writes each file in turn; closes when every file was written, else lists the ones that weren't. */
  async save(): Promise<void> {
    const writer = this.#opts.source()?.tags;
    const edit = this.edit();
    if (typeof edit === 'string') {
      this.errors.value = [edit];
      return;
    }
    if (!writer || this.readOnly.peek() !== null || this.saving.peek()) return;
    const targets = this.#loaded.filter((l) => l.song.format !== null && canEditFormat(l.song.format));
    const skipped = this.#loaded.filter((l) => !targets.includes(l));
    const total = targets.length;
    batch(() => {
      this.saving.value = true;
      this.errors.value = [];
      this.progress.value = total > SHOW_PROGRESS_ABOVE ? { done: 0, total } : null;
    });
    const written: Written[] = [];
    const errors = skipped.map(
      (l) =>
        `${baseName(l.song.path)}: Playlark can’t edit the tags of ${l.song.format?.toUpperCase() ?? 'these'} files yet.`,
    );
    for (const [i, { song }] of targets.entries()) {
      const result = await writer.write(song.path, edit, { size: song.size, mtime: song.mtime });
      if (result.ok) {
        if (result.file.size !== song.size || result.file.mtime !== song.mtime)
          written.push({ path: song.path, edit: result.undo, file: result.file });
      } else errors.push(result.message);
      if (this.progress.peek()) this.progress.value = { done: i + 1, total };
    }
    if (written.length > 0) this.#opts.undo.push(this.#step(writer, written));
    batch(() => {
      this.saving.value = false;
      this.progress.value = null;
      this.errors.value = errors;
    });
    if (errors.length === 0) this.#opts.close();
    if (written.length > 0) await this.#opts.refresh();
  }

  /** Undo and Redo of a save: each writes back what the last write replaced, with the same checks. */
  #step(writer: TagWriter, written: Written[]) {
    const flip = async () => {
      const failed: string[] = [];
      for (const w of written) {
        const result = await writer.write(w.path, w.edit, w.file);
        if (result.ok) {
          w.edit = result.undo;
          w.file = result.file;
        } else failed.push(result.message);
      }
      await this.#opts.refresh();
      if (failed.length > 0) throw new Error(failed.join(' '));
    };
    return { label: 'Edit Tags', undo: flip, redo: flip };
  }
}

export const FIELD_NAMES: Readonly<Record<InfoField, string>> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  genre: 'Genre',
  track: 'Track',
  trackTotal: 'Track total',
  disc: 'Disc',
  discTotal: 'Disc total',
  year: 'Year',
};
