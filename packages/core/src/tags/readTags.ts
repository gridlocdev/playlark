/** Reads any supported music file's tags and stream facts (PRD §4), picking the reader by its first bytes. */
import { type ByteSource, FormatError, startsWith, u32le } from '../bytes.ts';
import { readFlac } from './flac.ts';
import { ID3V1_LENGTH, readId3v1 } from './id3v1.ts';
import { id3v2Tags, parseId3v2, readId3v2At } from './id3v2.ts';
import { readMp3Stream } from './mp3.ts';
import { readMp4 } from './mp4.ts';
import { readOgg } from './ogg.ts';
import {
  type AudioFormat,
  type Picture,
  type ReadResult,
  type StreamInfo,
  type Tags,
  pickCover,
} from './types.ts';
import { readWav } from './wav.ts';

/** The format a file's extension claims, or null when Playlark doesn't read it. */
export function formatOfPath(path: string): AudioFormat | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'mp3':
      return 'mp3';
    case 'flac':
      return 'flac';
    case 'm4a':
    case 'mp4':
    case 'aac':
      return 'm4a';
    case 'ogg':
    case 'oga':
    case 'opus':
      return 'ogg';
    case 'wav':
    case 'wave':
      return 'wav';
    default:
      return null;
  }
}

/** The format the first bytes show; MP3 is the fallback, since a raw MPEG stream has no magic. */
function sniff(head: Uint8Array, byExtension: AudioFormat | null): AudioFormat {
  if (startsWith(head, 'fLaC')) return 'flac';
  if (startsWith(head, 'OggS')) return 'ogg';
  if (startsWith(head, 'RIFF') && startsWith(head, 'WAVE', 8)) return 'wav';
  if (startsWith(head, 'ftyp', 4)) return 'm4a';
  // FLAC files sometimes start with an ID3 tag too; trust the extension then.
  if (startsWith(head, 'ID3') && byExtension === 'flac') return 'flac';
  return 'mp3';
}

/** An APEv2 tag's footer: 32 bytes ending at `end`. Its size counts the items and footer, not the header. */
const APE_FOOTER = 32;

/** Where the audio ends once an APE tag before `end` is left out (PRD §4.1: APE tags are skipped, not read). */
async function apeStart(source: ByteSource, end: number): Promise<number> {
  if (end < APE_FOOTER) return end;
  const footer = await source.read(end - APE_FOOTER, APE_FOOTER);
  if (!startsWith(footer, 'APETAGEX')) return end;
  const size = u32le(footer, 12);
  const hasHeader = ((footer[23] ?? 0) & 0x80) !== 0;
  const start = end - size - (hasHeader ? APE_FOOTER : 0);
  return start >= 0 ? start : end;
}

type Read = { tags: Tags; stream: StreamInfo; cover?: Picture };

async function readMp3(source: ByteSource): Promise<Read> {
  const tag = await readId3v2At(source, 0);
  const v2 = tag ? parseId3v2(tag) : null;
  const v1 = await readId3v1(source);
  const end = await apeStart(source, source.size - (v1 ? ID3V1_LENGTH : 0));
  const stream = await readMp3Stream(source, tag?.length ?? 0, end);
  if (stream.sampleRate === 0) throw new FormatError('No MP3 audio was found in the file.');
  // ID3v2 wins; ID3v1 only fills in what it leaves out.
  const cover = v2 ? pickCover(v2.pictures) : undefined;
  return { tags: { ...v1, ...(v2 ? id3v2Tags(v2) : {}) }, stream, ...(cover ? { cover } : {}) };
}

const READERS: Readonly<Record<AudioFormat, (s: ByteSource) => Promise<Read>>> = {
  mp3: readMp3,
  flac: readFlac,
  m4a: readMp4,
  ogg: readOgg,
  wav: readWav,
};

/** Never throws: a file it can't read comes back with the reason, to show in the library (PRD §4.4). */
export async function readTags(source: ByteSource, path: string): Promise<ReadResult> {
  try {
    if (source.size === 0) return { ok: false, error: 'The file is empty.' };
    const head = await source.read(0, 12);
    const format = sniff(head, formatOfPath(path));
    const { tags, stream, cover } = await READERS[format](source);
    return { ok: true, format, tags, stream, ...(cover ? { cover } : {}) };
  } catch (e) {
    if (e instanceof FormatError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
