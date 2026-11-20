/**
 * Writing M4A tags (PRD §11.2): `moov/udta/meta/ilst` is rewritten, keeping the items the edit doesn't name. When
 * `moov` changes size a `free` atom beside it takes up the difference; failing that, and when `moov` sits before
 * `mdat`, every `stco`/`co64` chunk offset is shifted by the difference.
 */
import { FormatError, concatBytes, fourCC, u32be, u64be } from '../bytes.ts';
import { type ReadTags, type TagEdit, editedPair, sameBytes } from './edit.ts';
import { type Atom, atoms, path } from './mp4.ts';

/** The `free` atom put after a `moov` that had to move the audio, so the next edit fits without moving it. */
export const MP4_PADDING = 1024;

const be32 = (n: number) => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
const name = (type: string) => Uint8Array.from(type, (c) => c.charCodeAt(0) & 0xff);
const utf8 = new TextEncoder();

function box(type: string, body: Uint8Array): Uint8Array {
  return concatBytes([be32(8 + body.length), name(type), body]);
}

const headerOf = (atom: Uint8Array) => (u32be(atom, 0) === 1 ? 16 : 8);

/**
 * `atom` (a whole atom, header included) with its first `type` child replaced by what `make` gives (null drops
 * it), or `make`'s atom added at the end when there's none. `skip` is the bytes before the first child.
 */
function replaceChild(
  atom: Uint8Array,
  skip: number,
  type: string,
  make: (old: Uint8Array | undefined) => Uint8Array | null,
): Uint8Array {
  const bodyStart = headerOf(atom) + skip;
  const parts: Uint8Array[] = [atom.subarray(headerOf(atom), bodyStart)];
  let found = false;
  for (const a of atoms(atom, bodyStart, atom.length)) {
    const bytes = atom.subarray(a.at, a.end);
    if (a.type === type && !found) {
      found = true;
      const replaced = make(bytes);
      if (replaced) parts.push(replaced);
    } else parts.push(bytes);
  }
  if (!found) {
    const added = make(undefined);
    if (added) parts.push(added);
  }
  return box(fourCC(atom, 4), concatBytes(parts));
}

function item(type: string, dataType: number, payload: Uint8Array): Uint8Array {
  return box(type, box('data', concatBytes([be32(dataType), be32(0), payload])));
}

const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];

/** The `ilst` items after `edit`: the ones it names are dropped and written again at the end. */
function editIlst(ilst: Uint8Array | undefined, read: ReadTags, edit: TagEdit): Uint8Array {
  const drop = new Set<string>();
  const add: Uint8Array[] = [];
  const text = (types: readonly string[], value: string | null | undefined) => {
    if (value === undefined) return;
    for (const t of types) drop.add(t);
    if (value !== null) add.push(item(types[0]!, 1, utf8.encode(value)));
  };
  text(['©nam'], edit.title);
  text(['©ART'], edit.artist);
  text(['©alb'], edit.album);
  text(['aART'], edit.albumArtist);
  text(['©gen', 'gnre'], edit.genre);
  text(['©day'], edit.year === undefined ? undefined : edit.year === null ? null : String(edit.year));
  const track = editedPair(read.tags, edit, 'track');
  if (track.changed) {
    drop.add('trkn');
    if (track.n !== undefined || track.of !== undefined)
      add.push(item('trkn', 0, Uint8Array.of(0, 0, ...u16(track.n ?? 0), ...u16(track.of ?? 0), 0, 0)));
  }
  const disc = editedPair(read.tags, edit, 'disc');
  if (disc.changed) {
    drop.add('disk');
    if (disc.n !== undefined || disc.of !== undefined)
      add.push(item('disk', 0, Uint8Array.of(0, 0, ...u16(disc.n ?? 0), ...u16(disc.of ?? 0))));
  }
  if (edit.compilation !== undefined) {
    drop.add('cpil');
    if (edit.compilation) add.push(item('cpil', 21, Uint8Array.of(1)));
  }
  if (edit.cover !== undefined) {
    drop.add('covr');
    if (edit.cover) {
      const code = edit.cover.mime === 'image/png' ? 14 : edit.cover.mime === 'image/jpeg' ? 13 : 0;
      if (code === 0) throw new FormatError('An M4A file’s cover has to be a JPEG or PNG picture.');
      add.push(item('covr', code, edit.cover.data));
    }
  }
  const kept: Uint8Array[] = [];
  if (ilst)
    for (const a of atoms(ilst, headerOf(ilst), ilst.length))
      if (!drop.has(a.type)) kept.push(ilst.subarray(a.at, a.end));
  return box('ilst', concatBytes([...kept, ...add]));
}

/** `meta` is a full box in MP4 files (4 bytes of version and flags) but not in QuickTime ones. */
const metaSkip = (meta: Uint8Array) => (fourCC(meta, headerOf(meta) + 4) === 'hdlr' ? 0 : 4);

const NEW_META_HDLR = box(
  'hdlr',
  concatBytes([new Uint8Array(8), name('mdir'), name('appl'), new Uint8Array(9)]),
);

function editMoov(moov: Uint8Array, read: ReadTags, edit: TagEdit): Uint8Array {
  return replaceChild(moov, 0, 'udta', (udta) =>
    replaceChild(udta ?? box('udta', new Uint8Array(0)), 0, 'meta', (meta) => {
      const m = meta ?? box('meta', concatBytes([new Uint8Array(4), NEW_META_HDLR]));
      return replaceChild(m, metaSkip(m), 'ilst', (ilst) => editIlst(ilst, read, edit));
    }),
  );
}

/** Every `stco` and `co64` table in a `moov` atom: where its entries start, how many, and their width. */
function* chunkTables(moov: Uint8Array): Generator<{ at: number; count: number; wide: boolean }> {
  const root: Atom = { type: 'moov', at: 0, start: headerOf(moov), end: moov.length };
  for (const trak of atoms(moov, root.start, root.end)) {
    if (trak.type !== 'trak') continue;
    const stbl = path(moov, trak, 'mdia', 'minf', 'stbl');
    if (!stbl) continue;
    for (const t of atoms(moov, stbl.start, stbl.end))
      if (t.type === 'stco' || t.type === 'co64')
        yield { at: t.start + 8, count: u32be(moov, t.start + 4), wide: t.type === 'co64' };
  }
}

function chunkOffsets(moov: Uint8Array): number[] {
  const out: number[] = [];
  for (const t of chunkTables(moov))
    for (let i = 0; i < t.count; i++)
      out.push(t.wide ? u64be(moov, t.at + i * 8) : u32be(moov, t.at + i * 4));
  return out;
}

/** Moves every chunk offset at or after `from` by `shift`, in place. */
function shiftChunks(moov: Uint8Array, from: number, shift: number): void {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  for (const t of chunkTables(moov))
    for (let i = 0; i < t.count; i++) {
      if (t.wide) {
        const at = t.at + i * 8;
        const n = u64be(moov, at);
        if (n >= from) view.setBigUint64(at, BigInt(n + shift));
      } else {
        const at = t.at + i * 4;
        const n = u32be(moov, at);
        if (n < from) continue;
        if (n + shift > 0xffffffff) throw new FormatError('The M4A file is too big to edit its tags.');
        view.setUint32(at, n + shift);
      }
    }
}

function topAtoms(file: Uint8Array): Atom[] {
  const top = [...atoms(file, 0, file.length)];
  if (top[0]?.type !== 'ftyp') throw new FormatError('This isn’t an MP4 file.');
  return top;
}

export function writeMp4Tags(file: Uint8Array, read: ReadTags, edit: TagEdit): Uint8Array {
  const top = topAtoms(file);
  const index = top.findIndex((a) => a.type === 'moov');
  const old = top[index];
  if (!old) throw new FormatError('The MP4 file has no header.');
  const oldMoov = file.subarray(old.at, old.end);
  if (top.some((a) => a.type === 'moof') || path(file, old, 'mvex'))
    throw new FormatError('Playlark can’t edit the tags of a fragmented MP4 file.');
  const moov = editMoov(oldMoov, read, edit);
  const delta = moov.length - oldMoov.length;
  const next = top[index + 1];
  const before = file.subarray(0, old.at);
  if (delta === 0) return concatBytes([before, moov, file.subarray(old.end)]);
  // A free atom beside moov takes up the difference, so nothing after it moves.
  if (next?.type === 'free') {
    const room = next.end - next.at - delta;
    if (room === 0) return concatBytes([before, moov, file.subarray(next.end)]);
    if (room >= 8)
      return concatBytes([before, moov, box('free', new Uint8Array(room - 8)), file.subarray(next.end)]);
  }
  if (delta <= -8)
    return concatBytes([before, moov, box('free', new Uint8Array(-delta - 8)), file.subarray(old.end)]);
  const audioAfter = top.slice(index + 1).some((a) => a.type === 'mdat');
  if (!audioAfter) return concatBytes([before, moov, file.subarray(old.end)]);
  const padding = box('free', new Uint8Array(MP4_PADDING - 8));
  shiftChunks(moov, old.end, delta + padding.length);
  return concatBytes([before, moov, padding, file.subarray(old.end)]);
}

/** The audio of an M4A file: every `mdat` atom's body, in order. */
export function mp4Audio(file: Uint8Array): Uint8Array {
  return concatBytes(
    topAtoms(file)
      .filter((a) => a.type === 'mdat')
      .map((a) => file.subarray(a.start, a.end)),
  );
}

/** True when every chunk the old file's tables point at is where the new file's tables point, byte for byte. */
export function mp4ChunksMatch(before: Uint8Array, after: Uint8Array): boolean {
  const moovOf = (file: Uint8Array) => {
    const a = topAtoms(file).find((t) => t.type === 'moov');
    return a ? file.subarray(a.at, a.end) : new Uint8Array(0);
  };
  const a = chunkOffsets(moovOf(before));
  const b = chunkOffsets(moovOf(after));
  if (a.length !== b.length) return false;
  return a.every((offset, i) =>
    sameBytes(before.subarray(offset, offset + 64), after.subarray(b[i]!, b[i]! + 64)),
  );
}
