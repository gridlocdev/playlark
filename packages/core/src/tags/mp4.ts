/** MP4 audio files, .m4a (PRD §4): `moov` holds the stream facts and the iTunes-style `ilst` tags. */
import {
  type ByteSource,
  FormatError,
  decodeLatin1,
  decodeUtf8,
  fourCC,
  readExactly,
  u16be,
  u32be,
  u64be,
} from '../bytes.ts';
import { genreName } from './genres.ts';
import { pictureMime } from './picture.ts';
import {
  type Codec,
  type Picture,
  type ReplayGain,
  type StreamInfo,
  type Tags,
  parseYear,
  replayGainFrom,
  setText,
} from './types.ts';

/** `moov` with cover art can run to a few megabytes; anything past this is not a music file's. */
const MAX_MOOV = 64 * 1024 * 1024;

export interface Atom {
  readonly type: string;
  /** Where the header starts. */
  readonly at: number;
  /** Where the body starts. */
  readonly start: number;
  readonly end: number;
}

/** The atoms laid end to end in `b` between `from` and `to`. */
export function* atoms(b: Uint8Array, from: number, to: number): Generator<Atom> {
  let at = from;
  while (at + 8 <= to) {
    let size = u32be(b, at);
    const type = fourCC(b, at + 4);
    let header = 8;
    if (size === 1) {
      size = u64be(b, at + 8);
      header = 16;
    } else if (size === 0) size = to - at;
    if (size < header || at + size > to) return;
    yield { type, at, start: at + header, end: at + size };
    at += size;
  }
}

export function child(b: Uint8Array, parent: Atom, type: string, skip = 0): Atom | undefined {
  for (const a of atoms(b, parent.start + skip, parent.end)) if (a.type === type) return a;
  return undefined;
}

export function path(b: Uint8Array, parent: Atom, ...types: string[]): Atom | undefined {
  let at: Atom | undefined = parent;
  for (const t of types) {
    if (!at) return undefined;
    at = child(b, at, t);
  }
  return at;
}

/** `mvhd` and `mdhd` share a layout: a timescale and a duration, 32- or 64-bit by version. */
function timing(b: Uint8Array, a: Atom): { timescale: number; duration: number } {
  if (b[a.start] === 1) return { timescale: u32be(b, a.start + 20), duration: u64be(b, a.start + 24) };
  return { timescale: u32be(b, a.start + 12), duration: u32be(b, a.start + 16) };
}

const CODECS: Readonly<Record<string, Codec>> = {
  mp4a: 'aac',
  alac: 'alac',
  fLaC: 'flac',
  Opus: 'opus',
  '.mp3': 'mp3',
};

/** The sound track's stream facts. */
function soundTrack(b: Uint8Array, moov: Atom): StreamInfo | undefined {
  for (const trak of atoms(b, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const hdlr = path(b, trak, 'mdia', 'hdlr');
    if (!hdlr || fourCC(b, hdlr.start + 8) !== 'soun') continue;
    const mdhd = path(b, trak, 'mdia', 'mdhd');
    const stsd = path(b, trak, 'mdia', 'minf', 'stbl', 'stsd');
    const t = mdhd ? timing(b, mdhd) : { timescale: 0, duration: 0 };
    const stream: StreamInfo = {
      codec: 'unknown',
      duration: t.timescale > 0 ? t.duration / t.timescale : 0,
      sampleRate: t.timescale,
      channels: 0,
    };
    if (stsd) {
      // Past the version, flags and entry count: the first sample entry.
      const e = stsd.start + 8;
      stream.codec = CODECS[fourCC(b, e + 4)] ?? 'unknown';
      stream.channels = u16be(b, e + 24);
      stream.bitsPerSample = u16be(b, e + 26);
      const rate = u16be(b, e + 32);
      if (rate > 0 && stream.sampleRate === 0) stream.sampleRate = rate;
    }
    // The edit list's start skips the encoder delay (what ffmpeg writes); iTunSMPB, when present, wins.
    const elst = path(b, trak, 'edts', 'elst');
    if (elst && u32be(b, elst.start + 4) >= 1) {
      const mediaTime = b[elst.start] === 1 ? u64be(b, elst.start + 16) : u32be(b, elst.start + 12);
      if (mediaTime > 0 && mediaTime < 0x80000000) {
        stream.encoderDelay = mediaTime;
        if (t.timescale > 0) stream.duration = Math.max(0, stream.duration - mediaTime / t.timescale);
      }
    }
    return stream;
  }
  return undefined;
}

/** The `data` atom's value inside an `ilst` item: its type code and bytes. */
function dataOf(b: Uint8Array, item: Atom): { type: number; value: Uint8Array } | undefined {
  const data = child(b, item, 'data');
  if (!data) return undefined;
  return { type: u32be(b, data.start) & 0xffffff, value: b.subarray(data.start + 8, data.end) };
}

function text(d: { type: number; value: Uint8Array } | undefined): string | undefined {
  if (!d) return undefined;
  return d.type === 1 ? decodeUtf8(d.value) : decodeLatin1(d.value);
}

/** A big-endian integer `data` value of any width up to 8 bytes. */
function int(d: { value: Uint8Array } | undefined): number | undefined {
  if (!d || d.value.length === 0 || d.value.length > 8) return undefined;
  let n = 0;
  for (const byte of d.value) n = n * 256 + byte;
  return n;
}

/** iTunes' gapless info: " 00000000 DELAY PADDING SAMPLES …" in hex. */
function parseSmpb(value: string): { delay: number; padding: number; samples: number } | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 4) return undefined;
  const [, delay, padding, samples] = parts.map((p) => parseInt(p, 16));
  if (delay === undefined || padding === undefined || samples === undefined) return undefined;
  if (![delay, padding, samples].every(Number.isFinite)) return undefined;
  return { delay, padding, samples };
}

/** The `ilst` atom's tags, and its first `covr` picture. */
function ilstTags(b: Uint8Array, ilst: Atom, stream: StreamInfo): { tags: Tags; cover?: Picture } {
  const tags: Tags = {};
  let cover: Picture | undefined;
  const gains = new Map<string, string>();
  for (const item of atoms(b, ilst.start, ilst.end)) {
    const d = dataOf(b, item);
    switch (item.type) {
      case '©nam':
        setText(tags, 'title', text(d));
        break;
      case '©ART':
        setText(tags, 'artist', text(d));
        break;
      case 'aART':
        setText(tags, 'albumArtist', text(d));
        break;
      case '©alb':
        setText(tags, 'album', text(d));
        break;
      case '©gen':
        setText(tags, 'genre', text(d));
        break;
      case 'soar':
        setText(tags, 'artistSort', text(d));
        break;
      case 'soaa':
        setText(tags, 'albumArtistSort', text(d));
        break;
      case 'soal':
        setText(tags, 'albumSort', text(d));
        break;
      case 'sonm':
        setText(tags, 'titleSort', text(d));
        break;
      case 'covr': {
        // Type 13 is JPEG, 14 PNG; the bytes decide in the end.
        if (!cover && d && d.value.length > 0) {
          const declared = d.type === 14 ? 'image/png' : d.type === 13 ? 'image/jpeg' : '';
          const data = d.value.slice();
          cover = { mime: pictureMime(data, declared), type: 3, data };
        }
        break;
      }
      case 'gnre': {
        const n = int(d);
        if (n !== undefined && !tags.genre) {
          const name = genreName(n - 1);
          if (name) tags.genre = name;
        }
        break;
      }
      case '©day': {
        const year = parseYear(text(d));
        if (year !== undefined) tags.year = year;
        break;
      }
      case 'trkn':
      case 'disk': {
        if (!d || d.value.length < 6) break;
        const n = u16be(d.value, 2);
        const of = u16be(d.value, 4);
        if (n > 0) tags[item.type === 'trkn' ? 'track' : 'disc'] = n;
        if (of > 0) tags[item.type === 'trkn' ? 'trackTotal' : 'discTotal'] = of;
        break;
      }
      case 'cpil': {
        const n = int(d);
        if (n !== undefined) tags.compilation = n !== 0;
        break;
      }
      case '----': {
        const name = child(b, item, 'name');
        const key = name ? decodeUtf8(b.subarray(name.start + 4, name.end)) : '';
        if (key.toLowerCase().startsWith('replaygain_'))
          gains.set(key.slice(11).toUpperCase(), text(d) ?? '');
        else if (key === 'iTunSMPB') {
          const smpb = parseSmpb(text(d) ?? '');
          if (smpb) {
            stream.encoderDelay = smpb.delay;
            stream.encoderPadding = smpb.padding;
            if (smpb.samples > 0 && stream.sampleRate > 0) stream.duration = smpb.samples / stream.sampleRate;
          }
        }
        break;
      }
    }
  }
  const replayGain: ReplayGain | undefined = replayGainFrom((key) => gains.get(key));
  if (replayGain) tags.replayGain = replayGain;
  return { tags, ...(cover ? { cover } : {}) };
}

/** `meta` is a full box in MP4 files (4 bytes of version and flags) but not in QuickTime ones. */
function ilstIn(b: Uint8Array, meta: Atom): Atom | undefined {
  const skip = fourCC(b, meta.start + 4) === 'hdlr' ? 0 : 4;
  return child(b, meta, 'ilst', skip);
}

export async function readMp4(
  source: ByteSource,
): Promise<{ tags: Tags; stream: StreamInfo; cover?: Picture }> {
  let at = 0;
  let moov: Uint8Array | undefined;
  let mdatBytes = 0;
  let sawFtyp = false;
  while (at + 8 <= source.size) {
    const h = await source.read(at, 16);
    if (h.length < 8) break;
    let size = u32be(h, 0);
    const type = fourCC(h, 4);
    if (at === 0 && type !== 'ftyp') throw new FormatError('This isn’t an MP4 file.');
    if (type === 'ftyp') sawFtyp = true;
    if (size === 1) size = u64be(h, 8);
    else if (size === 0) size = source.size - at;
    if (size < 8) throw new FormatError('The MP4 file is damaged.');
    if (type === 'moov') {
      if (size > MAX_MOOV) throw new FormatError('The MP4 file’s header is too large to read.');
      moov = await readExactly(source, at, size, 'MP4 header');
    } else if (type === 'mdat') mdatBytes += size;
    at += size;
  }
  if (!sawFtyp || !moov) throw new FormatError('The MP4 file has no header.');
  const root = atoms(moov, 0, moov.length).next().value;
  if (!root) throw new FormatError('The MP4 file is damaged.');
  const stream = soundTrack(moov, root);
  if (!stream) throw new FormatError('The MP4 file has no sound.');
  if (stream.duration === 0) {
    const mvhd = child(moov, root, 'mvhd');
    if (mvhd) {
      const t = timing(moov, mvhd);
      if (t.timescale > 0) stream.duration = t.duration / t.timescale;
    }
  }
  const meta = path(moov, root, 'udta', 'meta') ?? child(moov, root, 'meta');
  const ilst = meta ? ilstIn(moov, meta) : undefined;
  const read = ilst ? ilstTags(moov, ilst, stream) : { tags: {} };
  if (stream.duration > 0 && mdatBytes > 0) stream.bitrate = Math.round((mdatBytes * 8) / stream.duration);
  return { ...read, stream };
}
