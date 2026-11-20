import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { id3Genre, id3v2Tags, memorySource, parseId3v1, parseId3v2, readTags } from '../src/index.ts';
import { AUDIO, LIBRARY, ascii, fixture } from './helpers.ts';

async function read(path: string) {
  const r = await readTags(await fixture(path), path);
  if (!r.ok) throw new Error(r.error);
  return r;
}

const NW = join(LIBRARY, 'Northwind Quartet/Harbour Lights');
const PK = join(LIBRARY, 'Paper Kites Club/Small Hours');

describe('reading tags from each format', () => {
  it('reads an MP3 with an ID3v2.4 tag and a LAME header', async () => {
    const r = await read(join(NW, '01 Morning Tide.mp3'));
    expect(r.format).toBe('mp3');
    expect(r.tags).toEqual({
      title: 'Morning Tide',
      artist: 'Northwind Quartet',
      album: 'Harbour Lights',
      albumArtist: 'Northwind Quartet',
      track: 1,
      trackTotal: 3,
      year: 2021,
      genre: 'Jazz',
    });
    expect(r.stream.codec).toBe('mp3');
    expect(r.stream.sampleRate).toBe(44100);
    expect(r.stream.duration).toBeCloseTo(2, 2);
    expect(r.stream.encoderDelay).toBeGreaterThan(529);
    expect(r.stream.encoderPadding).toBeGreaterThanOrEqual(0);
  });

  it('reads ID3v2.3 with UTF-16 text, a numbered genre and the compilation flag', async () => {
    const r = await read(join(AUDIO, 'id3v23.mp3'));
    expect(r.tags).toMatchObject({
      title: 'Ünïcödé Title',
      artist: 'Artist 2.3',
      track: 7,
      trackTotal: 9,
      disc: 1,
      discTotal: 1,
      year: 1999,
      genre: 'Rock',
      compilation: true,
    });
  });

  it('works out a constant-bitrate MP3’s length without a Xing header', async () => {
    const r = await read(join(AUDIO, 'cbr-no-xing.mp3'));
    expect(r.stream.bitrate).toBe(128000);
    expect(r.stream.duration).toBeGreaterThan(0.95);
    expect(r.stream.duration).toBeLessThan(1.1);
  });

  it('reads an MP3 with no tags at all', async () => {
    const r = await read(join(LIBRARY, 'Loose/untagged.mp3'));
    expect(r.tags).toEqual({});
    expect(r.stream.duration).toBeCloseTo(2, 2);
  });

  it('reads FLAC stream info and Vorbis comments, TRACKTOTAL included', async () => {
    const r = await read(join(NW, '02 Salt Air.flac'));
    expect(r.format).toBe('flac');
    expect(r.tags).toMatchObject({ title: 'Salt Air', track: 2, trackTotal: 3, year: 2021 });
    expect(r.stream).toMatchObject({ codec: 'flac', sampleRate: 44100, channels: 1, bitsPerSample: 16 });
    expect(r.stream.duration).toBeCloseTo(2, 3);
  });

  it('reads AAC in MP4, trimming the priming samples from the length', async () => {
    const r = await read(join(NW, '03 Lantern Walk.m4a'));
    expect(r.format).toBe('m4a');
    expect(r.tags).toMatchObject({
      title: 'Lantern Walk',
      albumArtist: 'Northwind Quartet',
      track: 3,
      trackTotal: 3,
    });
    expect(r.stream.codec).toBe('aac');
    expect(r.stream.encoderDelay).toBe(1024);
    expect(r.stream.duration).toBeCloseTo(2, 2);
  });

  it('reads ALAC in MP4 with disc numbers and the compilation flag', async () => {
    const r = await read(join(AUDIO, 'alac.m4a'));
    expect(r.stream.codec).toBe('alac');
    expect(r.tags).toMatchObject({
      title: 'Lossless',
      track: 2,
      trackTotal: 5,
      disc: 1,
      discTotal: 2,
      compilation: true,
    });
  });

  it('reads Ogg Vorbis', async () => {
    const r = await read(join(PK, '1-01 Static Bloom.ogg'));
    expect(r.format).toBe('ogg');
    expect(r.stream).toMatchObject({ codec: 'vorbis', channels: 2, sampleRate: 44100 });
    expect(r.stream.duration).toBeCloseTo(2, 2);
    expect(r.tags).toMatchObject({ title: 'Static Bloom', disc: 1, discTotal: 2, year: 2019 });
  });

  it('reads Opus, leaving the pre-skip out of the length', async () => {
    const r = await read(join(PK, '2-01 Night Bus.opus'));
    expect(r.stream).toMatchObject({ codec: 'opus', sampleRate: 48000 });
    expect(r.stream.encoderDelay).toBeGreaterThan(0);
    expect(r.stream.duration).toBeCloseTo(2, 2);
    expect(r.tags).toMatchObject({ title: 'Night Bus', disc: 2, discTotal: 2 });
  });

  it('reads WAV with a LIST/INFO chunk', async () => {
    const r = await read(join(LIBRARY, 'Field Recordings/rain-on-tin.wav'));
    expect(r.stream).toMatchObject({ codec: 'pcm', sampleRate: 22050, channels: 1, bitsPerSample: 16 });
    expect(r.stream.duration).toBeCloseTo(2, 3);
    expect(r.tags).toMatchObject({ title: 'Rain on Tin', artist: 'Field Recordings' });
  });

  it('reads WAV with an id3 chunk', async () => {
    const r = await read(join(AUDIO, 'wav-id3.wav'));
    expect(r.tags).toMatchObject({ title: 'WAV With ID3', artist: 'Chunk Artist', album: 'Chunk Album' });
  });

  it('gives a reason instead of throwing for a file that isn’t music', async () => {
    const r = await readTags(memorySource(new Uint8Array(ascii('Not music.\n'))), 'notes.mp3');
    expect(r.ok).toBe(false);
    const empty = await readTags(memorySource(new Uint8Array()), 'empty.flac');
    expect(empty).toEqual({ ok: false, error: 'The file is empty.' });
    const cut = await readTags(memorySource(new Uint8Array(ascii('fLaC'))), 'cut.flac');
    expect(cut.ok).toBe(false);
  });
});

/** An ID3v2 tag built by hand: header, then frames of [id, flags, body]. */
function id3(version: 2 | 3 | 4, frames: [string, number[]][], tagFlags = 0): Uint8Array {
  const body: number[] = [];
  for (const [id, data] of frames) {
    body.push(...ascii(id));
    const n = data.length;
    if (version === 2) body.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
    else if (version === 3) body.push((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 0, 0);
    else body.push((n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f, 0, 0);
    body.push(...data);
  }
  body.push(0, 0, 0, 0);
  const n = body.length;
  return new Uint8Array([
    ...ascii('ID3'),
    version,
    0,
    tagFlags,
    (n >> 21) & 0x7f,
    (n >> 14) & 0x7f,
    (n >> 7) & 0x7f,
    n & 0x7f,
    ...body,
  ]);
}

const latin1 = (s: string) => [0, ...ascii(s)];
const utf8 = (s: string) => [3, ...new TextEncoder().encode(s)];

describe('ID3v2 details', () => {
  it('maps ID3v2.2’s three-letter frames', () => {
    const tag = parseId3v2(
      id3(2, [
        ['TT2', latin1('Old Title')],
        ['TP1', latin1('Old Artist')],
        ['TRK', latin1('4/10')],
      ]),
    );
    expect(id3v2Tags(tag!)).toEqual({ title: 'Old Title', artist: 'Old Artist', track: 4, trackTotal: 10 });
  });

  it('joins several values in one frame and reads TXXX by description', () => {
    const tag = parseId3v2(
      id3(4, [
        ['TPE1', [...utf8('One'), 0, ...new TextEncoder().encode('Two')]],
        ['TXXX', [...utf8('COMPILATION'), 0, ...new TextEncoder().encode('1')]],
      ]),
    );
    expect(id3v2Tags(tag!)).toEqual({ artist: 'One, Two', compilation: true });
  });

  it('reads UTF-16 values with and without their own byte-order mark', () => {
    const le = (s: string) => Array.from(s).flatMap((c) => [c.charCodeAt(0), 0]);
    const tag = parseId3v2(id3(3, [['TPE1', [1, 0xff, 0xfe, ...le('Aé'), 0, 0, ...le('Bö')]]]));
    expect(tag!.text.get('TPE1')).toBe('Aé, Bö');
  });

  it('undoes whole-tag unsynchronisation in ID3v2.3', () => {
    const raw = id3(3, [['TIT2', [0, 0x41, 0xff, 0x42]]]);
    // Unsynchronise the frames: 0xFF followed by anything becomes 0xFF 0x00.
    const frames = Array.from(raw.subarray(10)).flatMap((b) => (b === 0xff ? [0xff, 0x00] : [b]));
    const n = frames.length;
    const tag = new Uint8Array([...ascii('ID3'), 3, 0, 0x80, 0, 0, (n >> 7) & 0x7f, n & 0x7f, ...frames]);
    expect(parseId3v2(tag)!.text.get('TIT2')).toBe('AÿB');
  });

  it('reads ID3v2.4 frames whose sizes were written as plain numbers', () => {
    const title = latin1('x'.repeat(200));
    const raw = id3(4, [
      ['TIT2', title],
      ['TPE1', latin1('After')],
    ]);
    // Rewrite the first frame's size as a plain 32-bit number (201 = 0xC9), as old iTunes did.
    raw.set([0, 0, 0, 0xc9], 14);
    const tag = parseId3v2(raw)!;
    expect(tag.text.get('TIT2')).toHaveLength(200);
    expect(tag.text.get('TPE1')).toBe('After');
  });

  it('reads genres as numbers, in brackets, and as text', () => {
    expect(id3Genre('17')).toBe('Rock');
    expect(id3Genre('(8)')).toBe('Jazz');
    expect(id3Genre('(17)Indie Rock')).toBe('Indie Rock');
    expect(id3Genre('(RX)')).toBe('Remix');
    expect(id3Genre('Shoegaze')).toBe('Shoegaze');
  });
});

describe('ID3v1', () => {
  it('reads v1.1 with a track number', () => {
    const b = new Uint8Array(128);
    b.set(ascii('TAG'));
    b.set(ascii('Title'), 3);
    b.set(ascii('Artist'), 33);
    b.set(ascii('Album'), 63);
    b.set(ascii('1987'), 93);
    b[126] = 5;
    b[127] = 13;
    expect(parseId3v1(b)).toEqual({
      title: 'Title',
      artist: 'Artist',
      album: 'Album',
      year: 1987,
      track: 5,
      genre: 'Pop',
    });
  });
});
