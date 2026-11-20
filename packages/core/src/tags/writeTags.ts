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
import type { AudioFormat, StreamInfo } from './types.ts';
import { flacAudio, writeFlacTags } from './writeFlac.ts';
import { mp3Audio, writeMp3Tags } from './writeId3.ts';
import { mp4Audio, mp4ChunksMatch, writeMp4Tags } from './writeMp4.ts';
import { oggAudio, writeOggTags } from './writeOgg.ts';
import { wavAudio, writeWavTags } from './writeWav.ts';

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

const WRITERS: Record<AudioFormat, FormatWriter> = {
  mp3: { write: writeMp3Tags, audio: mp3Audio },
  flac: { write: writeFlacTags, audio: flacAudio },
  m4a: { write: writeMp4Tags, audio: mp4Audio, extraCheck: mp4ChunksMatch },
  ogg: { write: writeOggTags, audio: oggAudio },
  wav: { write: writeWavTags, audio: wavAudio },
};

/** True when Playlark can edit this format's tags: every format it reads (§11.1). */
export function canEditFormat(format: AudioFormat): boolean {
  return format in WRITERS;
}

export interface Rewritten {
  /** The new file, or null when the edit changes nothing in it. */
  readonly bytes: Uint8Array | null;
  /** The edit that puts the old tags back. */
  readonly undo: TagEdit;
}

/**
 * True when the stream facts match. The bit rate is left out: where a file doesn't state it (Ogg), it comes from
 * the file's size, which a tag edit changes. The audio bytes are compared on their own.
 */
function sameStream(a: StreamInfo, b: StreamInfo): boolean {
  const { bitrate: _a, ...restA } = a;
  const { bitrate: _b, ...restB } = b;
  return JSON.stringify(restA) === JSON.stringify(restB);
}

/** `file` (named `path`, for its format) with `edit` written into its tags and checked. */
export async function rewriteTags(file: Uint8Array, path: string, edit: TagEdit): Promise<Rewritten> {
  const clean = cleanEdit(edit);
  const read = await readTags(memorySource(file), path);
  if (!read.ok) throw new FormatError(read.error);
  const writer = WRITERS[read.format];
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
    sameStream(after.stream, read.stream) &&
    sameBytes(writer.audio(file), writer.audio(bytes)) &&
    (writer.extraCheck?.(file, bytes) ?? true);
  if (!ok) throw new TagCheckError('the check after writing failed');
  return { bytes, undo };
}
