/** Reads any supported music file's tags and stream facts (PRD §4), picking the reader by its first bytes. */
import { type ByteSource, FormatError, startsWith } from '../bytes.ts';
import { readFlac } from './flac.ts';
import { ID3V1_LENGTH, readId3v1 } from './id3v1.ts';
import { id3v2Tags, parseId3v2, readId3v2At } from './id3v2.ts';
import { readMp3Stream } from './mp3.ts';
import { readMp4 } from './mp4.ts';
import { readOgg } from './ogg.ts';
import type { AudioFormat, ReadResult, StreamInfo, Tags } from './types.ts';
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

async function readMp3(source: ByteSource): Promise<{ tags: Tags; stream: StreamInfo }> {
  const tag = await readId3v2At(source, 0);
  const v2 = tag ? parseId3v2(tag) : null;
  const v1 = await readId3v1(source);
  const end = source.size - (v1 ? ID3V1_LENGTH : 0);
  const stream = await readMp3Stream(source, tag?.length ?? 0, end);
  if (stream.sampleRate === 0) throw new FormatError('No MP3 audio was found in the file.');
  // ID3v2 wins; ID3v1 only fills in what it leaves out.
  return { tags: { ...v1, ...(v2 ? id3v2Tags(v2) : {}) }, stream };
}

const READERS: Readonly<Record<AudioFormat, (s: ByteSource) => Promise<{ tags: Tags; stream: StreamInfo }>>> =
  {
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
    const { tags, stream } = await READERS[format](source);
    return { ok: true, format, tags, stream };
  } catch (e) {
    if (e instanceof FormatError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
