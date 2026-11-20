/** FLAC files (PRD §4): STREAMINFO for the stream, VORBIS_COMMENT for the tags. */
import { type ByteSource, FormatError, readExactly, startsWith, u24be, u32be } from '../bytes.ts';
import { readId3v2At } from './id3v2.ts';
import type { StreamInfo, Tags } from './types.ts';
import { parseVorbisComment, vorbisTags } from './vorbisComment.ts';

const STREAMINFO = 0;
const VORBIS_COMMENT = 4;

export async function readFlac(source: ByteSource): Promise<{ tags: Tags; stream: StreamInfo }> {
  // Some taggers put an ID3v2 tag in front of the "fLaC" marker; skip it.
  const id3 = await readId3v2At(source, 0);
  let at = id3?.length ?? 0;
  const magic = await readExactly(source, at, 4, 'FLAC marker');
  if (!startsWith(magic, 'fLaC')) throw new FormatError('This isn’t a FLAC file.');
  at += 4;
  let stream: StreamInfo | undefined;
  let tags: Tags = {};
  for (;;) {
    const header = await readExactly(source, at, 4, 'FLAC metadata');
    const last = ((header[0] ?? 0) & 0x80) !== 0;
    const type = (header[0] ?? 0) & 0x7f;
    const length = u24be(header, 1);
    at += 4;
    if (type === STREAMINFO) {
      const b = await readExactly(source, at, 34, 'FLAC stream info');
      const sampleRate = (u24be(b, 10) >>> 4) & 0xfffff;
      const channels = (((b[12] ?? 0) >>> 1) & 7) + 1;
      const bitsPerSample = ((((b[12] ?? 0) & 1) << 4) | ((b[13] ?? 0) >>> 4)) + 1;
      const samples = ((b[13] ?? 0) & 0x0f) * 0x100000000 + u32be(b, 14);
      const duration = sampleRate > 0 ? samples / sampleRate : 0;
      stream = { codec: 'flac', duration, sampleRate, channels, bitsPerSample };
    } else if (type === VORBIS_COMMENT) {
      const comments = parseVorbisComment(await readExactly(source, at, length, 'FLAC tags'));
      if (comments) tags = vorbisTags(comments);
    }
    at += length;
    if (last || at >= source.size) break;
  }
  if (!stream) throw new FormatError('The FLAC file has no stream info.');
  if (stream.duration > 0) stream.bitrate = Math.round(((source.size - at) * 8) / stream.duration);
  return { tags, stream };
}
