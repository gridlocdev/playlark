/**
 * What a Song Info save changes (PRD §11.1): only the fields named in a `TagEdit` are written; null takes a field
 * out of the file. The writers touch nothing else, and the check after writing compares against `applyEdit`.
 */
import { decodeBase64, pictureMime } from './picture.ts';
import type { Picture, StreamInfo, Tags } from './types.ts';

export interface TagEdit {
  readonly title?: string | null;
  readonly artist?: string | null;
  readonly album?: string | null;
  readonly albumArtist?: string | null;
  readonly genre?: string | null;
  readonly track?: number | null;
  readonly trackTotal?: number | null;
  readonly disc?: number | null;
  readonly discTotal?: number | null;
  readonly year?: number | null;
  /** False takes the flag out of the file. */
  readonly compilation?: boolean;
  /** The front cover: a new picture (JPEG or PNG), or null to take every picture out. */
  readonly cover?: Picture | null;
}

export type EditTextField = 'title' | 'artist' | 'album' | 'albumArtist' | 'genre';
export type EditNumberField = 'track' | 'trackTotal' | 'disc' | 'discTotal' | 'year';

export const EDIT_TEXT_FIELDS: readonly EditTextField[] = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'genre',
];
export const EDIT_NUMBER_FIELDS: readonly EditNumberField[] = [
  'track',
  'trackTotal',
  'disc',
  'discTotal',
  'year',
];
/** Track numbers, totals and years beyond this aren't written: MP4 keeps track numbers in 16 bits. */
export const MAX_NUMBER = 65_535;

/** What reading a file gave, as far as a tag edit cares. */
export interface ReadTags {
  readonly tags: Tags;
  readonly stream: StreamInfo;
  readonly cover?: Picture;
}

/** The edit with text trimmed (blank means remove), and numbers that aren't positive whole numbers removed. */
export function cleanEdit(edit: TagEdit): TagEdit {
  const out: Record<string, unknown> = {};
  for (const f of EDIT_TEXT_FIELDS) {
    const v = edit[f];
    if (v === undefined) continue;
    const t = v?.trim();
    out[f] = t ? t : null;
  }
  for (const f of EDIT_NUMBER_FIELDS) {
    const v = edit[f];
    if (v === undefined) continue;
    out[f] = v !== null && Number.isInteger(v) && v > 0 && v <= MAX_NUMBER ? v : null;
  }
  if (edit.compilation !== undefined) out['compilation'] = edit.compilation;
  if (edit.cover !== undefined)
    out['cover'] = edit.cover && {
      mime: pictureMime(edit.cover.data, edit.cover.mime),
      type: 3,
      data: edit.cover.data,
    };
  return out as TagEdit;
}

/** True when the edit changes nothing in the file `read`. */
export function editChangesNothing(read: ReadTags, edit: TagEdit): boolean {
  const after = applyEdit(read, edit);
  return sameTags(read.tags, after.tags) && samePicture(read.cover, after.cover);
}

/** The tags and cover a file reads as once `edit` is written into it. */
export function applyEdit(read: ReadTags, edit: TagEdit): { tags: Tags; cover?: Picture } {
  const tags: Tags = { ...read.tags };
  const set = <K extends keyof Tags>(k: K, v: Tags[K] | null | undefined) => {
    if (v === undefined) return;
    if (v === null) delete tags[k];
    else tags[k] = v;
  };
  for (const f of EDIT_TEXT_FIELDS) set(f, edit[f]);
  for (const f of EDIT_NUMBER_FIELDS) set(f, edit[f]);
  if (edit.compilation !== undefined) set('compilation', edit.compilation ? true : null);
  const cover = edit.cover === undefined ? read.cover : (edit.cover ?? undefined);
  return { tags, ...(cover ? { cover } : {}) };
}

/** The edit that puts back what `edit` changed in the file `read` (PRD §11.3: an undo step). */
export function undoEdit(read: ReadTags, edit: TagEdit): TagEdit {
  const out: Record<string, unknown> = {};
  for (const f of [...EDIT_TEXT_FIELDS, ...EDIT_NUMBER_FIELDS])
    if (edit[f] !== undefined) out[f] = read.tags[f] ?? null;
  if (edit.compilation !== undefined) out['compilation'] = read.tags.compilation === true;
  if (edit.cover !== undefined) out['cover'] = read.cover ?? null;
  return out as TagEdit;
}

const TAG_KEYS: readonly (keyof Tags)[] = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'track',
  'trackTotal',
  'disc',
  'discTotal',
  'year',
  'genre',
  'compilation',
  'artistSort',
  'albumArtistSort',
  'albumSort',
  'titleSort',
  'replayGain',
];

/** The keys of `a` and `b` whose values differ. */
export function tagDifferences(a: Tags, b: Tags): (keyof Tags)[] {
  return TAG_KEYS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export function sameTags(a: Tags, b: Tags): boolean {
  return tagDifferences(a, b).length === 0;
}

export function samePicture(a: Picture | undefined, b: Picture | undefined): boolean {
  if (!a || !b) return a === b;
  return a.mime === b.mime && sameBytes(a.data, b.data);
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The track or disc pair after an edit: what the file has, with the edited halves replaced. */
export function editedPair(
  tags: Tags,
  edit: TagEdit,
  which: 'track' | 'disc',
): { n: number | undefined; of: number | undefined; changed: boolean } {
  const total = which === 'track' ? 'trackTotal' : 'discTotal';
  const n = edit[which] === undefined ? tags[which] : (edit[which] ?? undefined);
  const of = edit[total] === undefined ? tags[total] : (edit[total] ?? undefined);
  return { n, of, changed: edit[which] !== undefined || edit[total] !== undefined };
}

/**
 * A `TagEdit` from untrusted input (IPC, HTTP JSON), or null when any field has the wrong type. A cover's bytes
 * arrive as a Uint8Array over IPC, or in base64 in JSON.
 */
export function parseTagEdit(value: unknown): TagEdit | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const known = new Set<string>([...EDIT_TEXT_FIELDS, ...EDIT_NUMBER_FIELDS, 'compilation', 'cover']);
  if (Object.keys(v).some((k) => !known.has(k))) return null;
  const out: Record<string, unknown> = {};
  for (const f of EDIT_TEXT_FIELDS) {
    const x = v[f];
    if (x === undefined) continue;
    if (x !== null && (typeof x !== 'string' || x.length > 10_000)) return null;
    out[f] = x;
  }
  for (const f of EDIT_NUMBER_FIELDS) {
    const x = v[f];
    if (x === undefined) continue;
    if (x !== null && typeof x !== 'number') return null;
    out[f] = x;
  }
  if (v['compilation'] !== undefined) {
    if (typeof v['compilation'] !== 'boolean') return null;
    out['compilation'] = v['compilation'];
  }
  const cover = v['cover'];
  if (cover === null) out['cover'] = null;
  else if (cover !== undefined) {
    if (typeof cover !== 'object') return null;
    const c = cover as Record<string, unknown>;
    const data = c['data'];
    const bytes = data instanceof Uint8Array ? data : typeof data === 'string' ? decodeBase64(data) : null;
    if (!bytes || typeof c['mime'] !== 'string' || !['image/jpeg', 'image/png'].includes(c['mime']))
      return null;
    out['cover'] = { mime: c['mime'], type: 3, data: bytes };
  }
  return out as TagEdit;
}
