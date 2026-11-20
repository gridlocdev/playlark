/** WAV files (PRD §4): `fmt ` and `data` for the stream, LIST/INFO and an `id3 ` chunk for the tags. */
import {
  type ByteSource,
  FormatError,
  decodeLatin1,
  decodeUtf8,
  fourCC,
  readExactly,
  startsWith,
  u16le,
  u32le,
} from '../bytes.ts';
import { id3v2Tags, parseId3v2 } from './id3v2.ts';
import { type Picture, type StreamInfo, type Tags, parseYear, pickCover, setPair, setText } from './types.ts';

/** Tag chunks bigger than this are skipped. */
const MAX_TAG_CHUNK = 16 * 1024 * 1024;

/** INFO text: UTF-8 when it decodes cleanly, else Latin-1, with trailing NULs dropped. */
function infoText(b: Uint8Array): string {
  const end = b.indexOf(0);
  const raw = end < 0 ? b : b.subarray(0, end);
  const utf8 = decodeUtf8(raw);
  return utf8.includes('�') ? decodeLatin1(raw) : utf8;
}

function infoTags(b: Uint8Array): Tags {
  const tags: Tags = {};
  let at = 4; // past "INFO"
  while (at + 8 <= b.length) {
    const id = fourCC(b, at);
    const size = u32le(b, at + 4);
    const value = infoText(b.subarray(at + 8, at + 8 + size));
    switch (id) {
      case 'INAM':
        setText(tags, 'title', value);
        break;
      case 'IART':
        setText(tags, 'artist', value);
        break;
      case 'IPRD':
        setText(tags, 'album', value);
        break;
      case 'IGNR':
        setText(tags, 'genre', value);
        break;
      case 'ICRD': {
        const year = parseYear(value);
        if (year !== undefined) tags.year = year;
        break;
      }
      case 'ITRK':
      case 'IPRT':
        setPair(tags, 'track', value);
        break;
    }
    at += 8 + size + (size % 2);
  }
  return tags;
}

export async function readWav(
  source: ByteSource,
): Promise<{ tags: Tags; stream: StreamInfo; cover?: Picture }> {
  const riff = await readExactly(source, 0, 12, 'WAV header');
  if (!startsWith(riff, 'RIFF') || !startsWith(riff, 'WAVE', 8))
    throw new FormatError('This isn’t a WAV file.');
  let at = 12;
  let fmt: Uint8Array | undefined;
  let dataBytes = 0;
  let info: Tags = {};
  let id3: Tags = {};
  let cover: Picture | undefined;
  while (at + 8 <= source.size) {
    const h = await readExactly(source, at, 8, 'WAV chunk');
    const id = fourCC(h, 0);
    const size = u32le(h, 4);
    const body = at + 8;
    if (id === 'fmt ') fmt = await readExactly(source, body, Math.min(size, 40), 'WAV format');
    else if (id === 'data') dataBytes = Math.min(size, source.size - body);
    else if (id === 'LIST' && size <= MAX_TAG_CHUNK) {
      const list = await readExactly(source, body, size, 'WAV tags');
      if (startsWith(list, 'INFO')) info = infoTags(list);
    } else if ((id === 'id3 ' || id === 'ID3 ') && size <= MAX_TAG_CHUNK) {
      const parsed = parseId3v2(await readExactly(source, body, size, 'WAV tags'));
      if (parsed) {
        id3 = id3v2Tags(parsed);
        cover = pickCover(parsed.pictures);
      }
    }
    at = body + size + (size % 2);
  }
  if (!fmt) throw new FormatError('The WAV file has no format chunk.');
  const channels = u16le(fmt, 2);
  const sampleRate = u32le(fmt, 4);
  const byteRate = u32le(fmt, 8);
  const bitsPerSample = u16le(fmt, 14);
  const stream: StreamInfo = {
    codec: 'pcm',
    channels,
    sampleRate,
    bitsPerSample,
    duration: byteRate > 0 ? dataBytes / byteRate : 0,
    bitrate: byteRate * 8,
  };
  // The ID3 chunk is what modern taggers write; INFO fills in what it leaves out.
  return { tags: { ...info, ...id3 }, stream, ...(cover ? { cover } : {}) };
}
