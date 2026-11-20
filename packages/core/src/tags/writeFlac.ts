/**
 * Writing FLAC tags (PRD §11.2): the `VORBIS_COMMENT` block and the cover's `PICTURE` blocks are replaced; the
 * other blocks keep their order and bytes. `PADDING` takes up the difference when it can, so the audio stays put.
 */
import { FormatError, concatBytes, startsWith, u24be } from '../bytes.ts';
import type { ReadTags, TagEdit } from './edit.ts';
import { id3v2Length } from './id3v2.ts';
import { parseFlacPicture } from './picture.ts';
import {
  PLAYLARK_VENDOR,
  commentPictureTypes,
  editVorbisComments,
  flacPictureBlock,
  joinVorbisComment,
  splitVorbisComment,
} from './writeVorbis.ts';

const STREAMINFO = 0;
const PADDING = 1;
const VORBIS_COMMENT = 4;
const PICTURE = 6;
/** Padding a rewritten header gets, so the next edit fits without moving the audio. */
export const FLAC_PADDING = 4096;
const MAX_BLOCK = 0xffffff;

interface Block {
  readonly type: number;
  readonly body: Uint8Array;
}

/** The parts of a FLAC file: anything before "fLaC", the metadata blocks, and where the audio starts. */
function flacParts(file: Uint8Array): { prefix: Uint8Array; blocks: Block[]; audio: number } {
  const prefixLength = id3v2Length(file.subarray(0, 10)) ?? 0;
  if (!startsWith(file, 'fLaC', prefixLength)) throw new FormatError('This isn’t a FLAC file.');
  let at = prefixLength + 4;
  const blocks: Block[] = [];
  for (;;) {
    if (at + 4 > file.length) throw new FormatError('The file ends inside its FLAC metadata.');
    const last = ((file[at] ?? 0) & 0x80) !== 0;
    const type = (file[at] ?? 0) & 0x7f;
    const length = u24be(file, at + 1);
    if (at + 4 + length > file.length) throw new FormatError('The file ends inside its FLAC metadata.');
    blocks.push({ type, body: file.subarray(at + 4, at + 4 + length) });
    at += 4 + length;
    if (last) break;
  }
  return { prefix: file.subarray(0, prefixLength), blocks, audio: at };
}

function blockBytes(block: Block, last: boolean): Uint8Array {
  const n = block.body.length;
  if (n > MAX_BLOCK) throw new FormatError('The picture is too big for a FLAC file (16 MB at most).');
  return concatBytes([
    Uint8Array.of((last ? 0x80 : 0) | block.type, n >>> 16, (n >>> 8) & 0xff, n & 0xff),
    block.body,
  ]);
}

export function writeFlacTags(file: Uint8Array, read: ReadTags, edit: TagEdit): Uint8Array {
  const { prefix, blocks, audio } = flacParts(file);
  const oldMetadata = audio - prefix.length - 4;
  const comment = blocks.find((b) => b.type === VORBIS_COMMENT);
  const raw = comment ? splitVorbisComment(comment.body) : { vendor: PLAYLARK_VENDOR, entries: [] };
  if (!raw) throw new FormatError('The FLAC file’s tags are damaged.');
  // Which pictures the cover edit takes out: the front covers, or every picture when there's none.
  const types = [
    ...commentPictureTypes(raw),
    ...blocks.filter((b) => b.type === PICTURE).map((b) => parseFlacPicture(b.body)?.type ?? null),
  ];
  const hasFront = types.includes(3);
  const dropPicture = (type: number | null) =>
    edit.cover !== undefined && (edit.cover === null || !hasFront || type === 3);
  const newComment: Block = {
    type: VORBIS_COMMENT,
    body: joinVorbisComment(editVorbisComments(raw, read, edit, 'blocks', dropPicture)),
  };
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.type === PADDING) continue;
    if (b.type === PICTURE && dropPicture(parseFlacPicture(b.body)?.type ?? null)) continue;
    if (b.type === VORBIS_COMMENT) {
      if (b === comment) out.push(newComment);
      continue;
    }
    out.push(b);
    if (b.type === STREAMINFO && !comment) out.push(newComment);
  }
  if (edit.cover) {
    const at = out.indexOf(newComment) + 1;
    out.splice(at, 0, { type: PICTURE, body: flacPictureBlock(edit.cover) });
  }
  const used = out.reduce((n, b) => n + 4 + b.body.length, 0);
  const spare = oldMetadata - used;
  // The padding fills the space the old blocks took when it can, so the audio doesn't move.
  if (spare >= 4) out.push({ type: PADDING, body: new Uint8Array(spare - 4) });
  else if (spare !== 0) out.push({ type: PADDING, body: new Uint8Array(FLAC_PADDING) });
  return concatBytes([
    prefix,
    Uint8Array.from([0x66, 0x4c, 0x61, 0x43]),
    ...out.map((b, i) => blockBytes(b, i === out.length - 1)),
    file.subarray(audio),
  ]);
}

/** A FLAC file's audio frames: everything after the metadata. */
export function flacAudio(file: Uint8Array): Uint8Array {
  return file.subarray(flacParts(file).audio);
}
