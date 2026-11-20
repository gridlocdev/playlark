/** Ogg Vorbis and Opus files (PRD §4): the first two packets hold the stream and the tags; the last page the length. */
import {
  type ByteSource,
  FormatError,
  concatBytes,
  i64le,
  readExactly,
  startsWith,
  u16le,
  u32le,
} from '../bytes.ts';
import type { StreamInfo, Tags } from './types.ts';
import { parseVorbisComment, vorbisTags } from './vorbisComment.ts';

const PAGE_HEADER = 27;
/** The last page is searched for in this many bytes at the end of the file. */
const TAIL = 64 * 1024;
/** Tags with cover art can be large, but never this large. */
const MAX_HEADERS = 16 * 1024 * 1024;

interface Page {
  readonly serial: number;
  readonly granule: number;
  /** The segments' lengths. */
  readonly lacing: readonly number[];
  readonly body: Uint8Array;
  readonly length: number;
}

async function readPage(source: ByteSource, at: number): Promise<Page> {
  const header = await readExactly(source, at, PAGE_HEADER, 'Ogg page');
  if (!startsWith(header, 'OggS')) throw new FormatError('This isn’t an Ogg file.');
  const segments = header[26] ?? 0;
  const table = await readExactly(source, at + PAGE_HEADER, segments, 'Ogg page');
  const lacing = Array.from(table);
  const bodyLength = lacing.reduce((n, l) => n + l, 0);
  const body = await readExactly(source, at + PAGE_HEADER + segments, bodyLength, 'Ogg page');
  return {
    serial: u32le(header, 14),
    granule: i64le(header, 6),
    lacing,
    body,
    length: PAGE_HEADER + segments + bodyLength,
  };
}

/** The first `count` packets of the first stream. */
async function firstPackets(
  source: ByteSource,
  count: number,
): Promise<{ packets: Uint8Array[]; serial: number }> {
  const packets: Uint8Array[] = [];
  let pending: Uint8Array[] = [];
  let pendingLength = 0;
  let at = 0;
  let serial: number | undefined;
  while (packets.length < count && at < source.size) {
    const page = await readPage(source, at);
    at += page.length;
    serial ??= page.serial;
    if (page.serial !== serial) continue;
    let offset = 0;
    for (const l of page.lacing) {
      pending.push(page.body.subarray(offset, offset + l));
      pendingLength += l;
      offset += l;
      if (pendingLength > MAX_HEADERS) throw new FormatError('The Ogg file’s tags are too large to read.');
      // A segment shorter than 255 ends the packet.
      if (l < 255) {
        packets.push(concatBytes(pending));
        pending = [];
        pendingLength = 0;
        if (packets.length === count) break;
      }
    }
  }
  if (packets.length < count || serial === undefined)
    throw new FormatError('The Ogg file ends inside its headers.');
  return { packets, serial };
}

/** The granule position of the stream's last page: its length in samples. */
async function lastGranule(source: ByteSource, serial: number): Promise<number> {
  const start = Math.max(0, source.size - TAIL);
  const tail = await source.read(start, source.size - start);
  for (let i = tail.length - PAGE_HEADER; i >= 0; i--) {
    if (tail[i] !== 0x4f || !startsWith(tail, 'OggS', i)) continue;
    if (u32le(tail, i + 14) !== serial) continue;
    const granule = i64le(tail, i + 6);
    if (granule >= 0) return granule;
  }
  return 0;
}

export async function readOgg(source: ByteSource): Promise<{ tags: Tags; stream: StreamInfo }> {
  const { packets, serial } = await firstPackets(source, 2);
  const [head, comment] = packets as [Uint8Array, Uint8Array];
  const granule = await lastGranule(source, serial);
  let stream: StreamInfo;
  let commentBody: Uint8Array;
  if (head[0] === 1 && startsWith(head, 'vorbis', 1)) {
    const sampleRate = u32le(head, 12);
    const nominal = u32le(head, 20);
    stream = {
      codec: 'vorbis',
      channels: head[11] ?? 0,
      sampleRate,
      duration: sampleRate > 0 ? granule / sampleRate : 0,
      ...(nominal > 0 && nominal < 0x80000000 ? { bitrate: nominal } : {}),
    };
    if (!(comment[0] === 3 && startsWith(comment, 'vorbis', 1)))
      throw new FormatError('The Ogg file has no tags.');
    commentBody = comment.subarray(7);
  } else if (startsWith(head, 'OpusHead')) {
    // Opus always decodes at 48 kHz; the granule counts 48 kHz samples, pre-skip included.
    const preSkip = u16le(head, 10);
    stream = {
      codec: 'opus',
      channels: head[9] ?? 0,
      sampleRate: 48000,
      duration: Math.max(0, granule - preSkip) / 48000,
      encoderDelay: preSkip,
    };
    if (!startsWith(comment, 'OpusTags')) throw new FormatError('The Opus file has no tags.');
    commentBody = comment.subarray(8);
  } else {
    return {
      tags: {},
      stream: { codec: 'unknown', duration: 0, sampleRate: 0, channels: 0 },
    };
  }
  if (stream.duration > 0 && stream.bitrate === undefined)
    stream.bitrate = Math.round((source.size * 8) / stream.duration);
  const parsed = parseVorbisComment(commentBody);
  return { tags: parsed ? vorbisTags(parsed) : {}, stream };
}
