/**
 * Tag editing for a whole file in memory (PRD §11.2, §11.3): writes the edit, then reads the result back and
 * checks that its tags read as intended and its audio bytes are the original's. Throws when either fails.
 */
import { FormatError, memorySource } from '../bytes.ts';
import {
  type ReadTags,
  type TagEdit,
  applyEdit,
  cleanEdit,
  editChangesNothing,
  sameBytes,
  samePicture,
  sameTags,
  undoEdit,
} from './edit.ts';
import { readTags } from './readTags.ts';
import type { AudioFormat } from './types.ts';
import { flacAudio, writeFlacTags } from './writeFlac.ts';
import { mp3Audio, writeMp3Tags } from './writeId3.ts';
import { mp4Audio, mp4ChunksMatch, writeMp4Tags } from './writeMp4.ts';

/** The check after writing failed: the new bytes must not replace the file. */
export class TagCheckError extends Error {
  override readonly name = 'TagCheckError';
}

type Writer = (file: Uint8Array, read: ReadTags, edit: TagEdit) => Uint8Array;

interface FormatWriter {
  readonly write: Writer;
  /** The audio bytes, which a tag edit must leave as they were. */
  readonly audio: (file: Uint8Array) => Uint8Array;
  readonly extraCheck?: (before: Uint8Array, after: Uint8Array) => boolean;
}

const WRITERS: Partial<Record<AudioFormat, FormatWriter>> = {
  mp3: { write: writeMp3Tags, audio: mp3Audio },
  flac: { write: writeFlacTags, audio: flacAudio },
  m4a: { write: writeMp4Tags, audio: mp4Audio, extraCheck: mp4ChunksMatch },
};

/** True when Playlark can edit this format's tags. */
export function canEditFormat(format: AudioFormat): boolean {
  return WRITERS[format] !== undefined;
}

export interface Rewritten {
  /** The new file, or null when the edit changes nothing in it. */
  readonly bytes: Uint8Array | null;
  /** The edit that puts the old tags back. */
  readonly undo: TagEdit;
}

/** `file` (named `path`, for its format) with `edit` written into its tags and checked. */
export async function rewriteTags(file: Uint8Array, path: string, edit: TagEdit): Promise<Rewritten> {
  const clean = cleanEdit(edit);
  const read = await readTags(memorySource(file), path);
  if (!read.ok) throw new FormatError(read.error);
  const writer = WRITERS[read.format];
  if (!writer)
    throw new FormatError(`Playlark can’t edit the tags of ${read.format.toUpperCase()} files yet.`);
  const undo = undoEdit(read, clean);
  if (editChangesNothing(read, clean)) return { bytes: null, undo };
  const bytes = writer.write(file, read, clean);
  const after = await readTags(memorySource(bytes), path);
  const expected = applyEdit(read, clean);
  const ok =
    after.ok &&
    after.format === read.format &&
    sameTags(after.tags, expected.tags) &&
    samePicture(after.cover, expected.cover) &&
    JSON.stringify(after.stream) === JSON.stringify(read.stream) &&
    sameBytes(writer.audio(file), writer.audio(bytes)) &&
    (writer.extraCheck?.(file, bytes) ?? true);
  if (!ok) throw new TagCheckError('the check after writing failed');
  return { bytes, undo };
}
