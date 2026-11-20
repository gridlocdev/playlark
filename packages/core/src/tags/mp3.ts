/** MPEG audio stream facts (PRD §4.2, §4.3): duration from the Xing, Info or VBRI header, else the bitrate. */
import { type ByteSource, fourCC, startsWith, u16be, u32be } from '../bytes.ts';
import type { StreamInfo } from './types.ts';

/** Bitrates in kbps by [version is MPEG-1][layer index][bitrate index]. */
const BITRATES = {
  v1: [
    [],
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // layer III
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], // layer II
    [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], // layer I
  ],
  v2: [
    [],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  ],
} as const;
const SAMPLE_RATES = [44100, 48000, 32000] as const;

export interface FrameHeader {
  /** 1, 2 or 2.5. */
  readonly version: 1 | 2 | 2.5;
  /** 1, 2 or 3. */
  readonly layer: 1 | 2 | 3;
  readonly bitrate: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly samplesPerFrame: number;
  readonly frameLength: number;
}

/** Decodes the four-byte frame header at `at`, or null when the bytes aren't one. */
export function frameHeader(b: Uint8Array, at: number): FrameHeader | null {
  if (b.length < at + 4) return null;
  const h = u32be(b, at);
  if (h >>> 21 !== 0x7ff) return null;
  const versionBits = (h >>> 19) & 3;
  const layerBits = (h >>> 17) & 3;
  const bitrateIndex = (h >>> 12) & 15;
  const rateIndex = (h >>> 10) & 3;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3)
    return null;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer = (4 - layerBits) as 1 | 2 | 3;
  const table = version === 1 ? BITRATES.v1 : BITRATES.v2;
  const bitrate = (table[layerBits]?.[bitrateIndex] ?? 0) * 1000;
  const base = SAMPLE_RATES[rateIndex] ?? 44100;
  const sampleRate = version === 1 ? base : version === 2 ? base / 2 : base / 4;
  const padding = (h >>> 9) & 1;
  const channels = ((h >>> 6) & 3) === 3 ? 1 : 2;
  const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : version === 1 ? 1152 : 576;
  const frameLength =
    layer === 1
      ? Math.floor((12 * bitrate) / sampleRate + padding) * 4
      : Math.floor(((samplesPerFrame / 8) * bitrate) / sampleRate) + padding;
  if (frameLength < 4) return null;
  return { version, layer, bitrate, sampleRate, channels, samplesPerFrame, frameLength };
}

/** How far into the first frame the Xing or Info header sits: after the side information. */
function xingOffset(f: FrameHeader): number {
  if (f.version === 1) return 4 + (f.channels === 1 ? 17 : 32);
  return 4 + (f.channels === 1 ? 9 : 17);
}

/** How many bytes to search past the tag for the first frame. */
const SYNC_SEARCH = 64 * 1024;

/**
 * Finds the first frame at or after `start` (the end of any ID3v2 tag) and reads the stream facts. A frame only
 * counts when the next one follows where its length says, so stray 0xFF bytes in junk aren't taken for audio.
 */
export async function readMp3Stream(source: ByteSource, start: number, end: number): Promise<StreamInfo> {
  const chunk = await source.read(start, Math.min(SYNC_SEARCH, end - start));
  for (let i = 0; i + 4 <= chunk.length; i++) {
    if (chunk[i] !== 0xff) continue;
    const f = frameHeader(chunk, i);
    if (!f) continue;
    const nextAt = i + f.frameLength;
    if (nextAt + 4 <= chunk.length && !frameHeader(chunk, nextAt)) continue;
    const frame = await source.read(start + i, Math.max(f.frameLength, 200));
    return streamFrom(frame, f, end - (start + i));
  }
  return { codec: 'mp3', duration: 0, sampleRate: 0, channels: 0 };
}

function streamFrom(frame: Uint8Array, f: FrameHeader, audioBytes: number): StreamInfo {
  const base = { codec: 'mp3' as const, sampleRate: f.sampleRate, channels: f.channels };
  const xing = xingOffset(f);
  const tag = fourCC(frame, xing);
  if (tag === 'Xing' || tag === 'Info') {
    const flags = u32be(frame, xing + 4);
    let at = xing + 8;
    const frames = (flags & 1) !== 0 ? u32be(frame, at) : undefined;
    if ((flags & 1) !== 0) at += 4;
    const bytes = (flags & 2) !== 0 ? u32be(frame, at) : undefined;
    if ((flags & 2) !== 0) at += 4;
    if ((flags & 4) !== 0) at += 100;
    if ((flags & 8) !== 0) at += 4;
    // The LAME extension: 9 bytes of encoder name, then 12 bytes later the 24-bit delay and padding.
    const lame =
      startsWith(frame, 'LAME', at) || startsWith(frame, 'Lavc', at) || startsWith(frame, 'Lavf', at);
    let encoderDelay: number | undefined;
    let encoderPadding: number | undefined;
    if (lame && frame.length >= at + 24) {
      const d = at + 21;
      encoderDelay = ((frame[d] ?? 0) << 4) | ((frame[d + 1] ?? 0) >>> 4);
      encoderPadding = (((frame[d + 1] ?? 0) & 0x0f) << 8) | (frame[d + 2] ?? 0);
    }
    if (frames !== undefined && frames > 0) {
      const samples = frames * f.samplesPerFrame;
      // The decoder itself adds 529 samples of delay; LAME's figure leaves them out.
      const trimmed =
        encoderDelay !== undefined && encoderPadding !== undefined
          ? Math.max(0, samples - encoderDelay - encoderPadding)
          : samples;
      const duration = trimmed / f.sampleRate;
      const bitrate = bytes !== undefined && duration > 0 ? Math.round((bytes * 8) / duration) : f.bitrate;
      return {
        ...base,
        duration,
        bitrate,
        ...(encoderDelay !== undefined ? { encoderDelay: encoderDelay + 529 } : {}),
        ...(encoderPadding !== undefined ? { encoderPadding: Math.max(0, encoderPadding - 529) } : {}),
      };
    }
  }
  if (fourCC(frame, 36) === 'VBRI') {
    const bytes = u32be(frame, 36 + 10);
    const frames = u32be(frame, 36 + 14);
    const delay = u16be(frame, 36 + 6);
    if (frames > 0) {
      const duration = (frames * f.samplesPerFrame) / f.sampleRate;
      return { ...base, duration, bitrate: Math.round((bytes * 8) / duration), encoderDelay: delay };
    }
  }
  // A constant bitrate stream: the audio bytes over the bitrate.
  return { ...base, duration: f.bitrate > 0 ? (audioBytes * 8) / f.bitrate : 0, bitrate: f.bitrate };
}
