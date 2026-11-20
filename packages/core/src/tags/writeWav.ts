/**
 * Writing WAV tags (PRD §11.2): the `id3 ` chunk holds every field (created at the end when missing), and
 * LIST/INFO is updated for the fields it already has. Other chunks keep their bytes and order; the RIFF size is
 * fixed and every chunk stays word-aligned.
 */
import { FormatError, concatBytes, fourCC, startsWith, u32le } from '../bytes.ts';
import { type ReadTags, type TagEdit, editedPair } from './edit.ts';
import { writeMp3Tags } from './writeId3.ts';

interface Chunk {
  readonly id: string;
  readonly body: Uint8Array;
}

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const utf8 = new TextEncoder();

function le32(n: number): Uint8Array {
  return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

function chunkBytes(c: Chunk): Uint8Array {
  const pad = c.body.length % 2 ? [Uint8Array.of(0)] : [];
  return concatBytes([latin1(c.id), le32(c.body.length), c.body, ...pad]);
}

function parseChunks(b: Uint8Array, at: number): Chunk[] {
  const out: Chunk[] = [];
  while (at + 8 <= b.length) {
    const size = u32le(b, at + 4);
    if (at + 8 + size > b.length) throw new FormatError('The WAV file is cut short.');
    out.push({ id: fourCC(b, at), body: b.subarray(at + 8, at + 8 + size) });
    at += 8 + size + (size % 2);
  }
  if (at < b.length) throw new FormatError('The WAV file has bytes Playlark doesn’t understand at its end.');
  return out;
}

function wavChunks(file: Uint8Array): Chunk[] {
  if (!startsWith(file, 'RIFF') || !startsWith(file, 'WAVE', 8))
    throw new FormatError('This isn’t a WAV file.');
  // The RIFF size is fixed on the way out, so a wrong one doesn't matter here.
  return parseChunks(file, 12);
}

/** The INFO subchunks after `edit`: each field INFO has is changed, or taken out when the edit removes it. */
function editInfo(list: Uint8Array, read: ReadTags, edit: TagEdit): Uint8Array {
  const value = (id: string): string | null | undefined => {
    switch (id) {
      case 'INAM':
        return edit.title;
      case 'IART':
        return edit.artist;
      case 'IPRD':
        return edit.album;
      case 'IGNR':
        return edit.genre;
      case 'ICRD':
        return edit.year === undefined ? undefined : edit.year === null ? null : String(edit.year);
      case 'ITRK':
      case 'IPRT': {
        const pair = editedPair(read.tags, edit, 'track');
        if (!pair.changed) return undefined;
        return pair.n === undefined ? null : String(pair.n);
      }
      default:
        return undefined;
    }
  };
  const out: Chunk[] = [];
  for (const sub of parseChunks(list.subarray(4), 0)) {
    const v = value(sub.id);
    if (v === undefined) out.push(sub);
    else if (v !== null) out.push({ id: sub.id, body: concatBytes([utf8.encode(v), Uint8Array.of(0)]) });
  }
  return concatBytes([list.subarray(0, 4), ...out.map(chunkBytes)]);
}

const isId3 = (c: Chunk) => c.id === 'id3 ' || c.id === 'ID3 ';

export function writeWavTags(file: Uint8Array, read: ReadTags, edit: TagEdit): Uint8Array {
  const chunks = wavChunks(file);
  const out: Chunk[] = chunks.map((c) => {
    if (c.id === 'LIST' && startsWith(c.body, 'INFO'))
      return { id: c.id, body: editInfo(c.body, read, edit) };
    if (isId3(c)) return { id: c.id, body: writeMp3Tags(c.body, read, edit) };
    return c;
  });
  if (!chunks.some(isId3)) out.push({ id: 'id3 ', body: writeMp3Tags(new Uint8Array(), read, edit) });
  const body = concatBytes([latin1('WAVE'), ...out.map(chunkBytes)]);
  return concatBytes([latin1('RIFF'), le32(body.length), body]);
}

/** The `data` chunk: the samples a tag edit must leave as they were. */
export function wavAudio(file: Uint8Array): Uint8Array {
  return wavChunks(file).find((c) => c.id === 'data')?.body ?? new Uint8Array();
}
