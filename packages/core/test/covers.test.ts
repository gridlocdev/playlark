import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Picture,
  type Song,
  coverIds,
  decodeBase64,
  findMoves,
  makeIndex,
  memorySource,
  parseId3v2,
  parseIndex,
  readTags,
  scanLibrary,
  sha256Hex,
  parseVorbisComment,
  vorbisPictures,
  vorbisTags,
} from '../src/index.ts';
import { AUDIO, LIBRARY, ascii, fixture, folderSource } from './helpers.ts';

async function read(name: string) {
  const r = await readTags(await fixture(join(AUDIO, name)), name);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('covers, sort names and ReplayGain', () => {
  it('reads an MP3’s APIC picture, sort names and ReplayGain', async () => {
    const r = await read('apic.mp3');
    expect(r.cover).toMatchObject({ mime: 'image/png', type: 3 });
    expect(r.tags).toMatchObject({
      artistSort: 'Sorters, The',
      albumSort: 'Album Sort',
      titleSort: 'Cover, With',
      replayGain: { trackGain: -6.54, trackPeak: 0.988525, albumGain: -5.2 },
    });
  });

  it('reads a FLAC PICTURE block and Vorbis comment sort names', async () => {
    const r = await read('picture.flac');
    expect(r.cover?.mime).toBe('image/png');
    expect(r.tags).toMatchObject({
      artistSort: 'Sorters, The',
      albumArtistSort: 'Band, A',
      replayGain: { trackGain: 1.25, albumPeak: 0.5 },
    });
  });

  it('reads an M4A covr atom', async () => {
    const r = await read('covr.m4a');
    expect(r.cover?.mime).toBe('image/png');
    expect(r.cover?.data).toEqual(new Uint8Array(await readFile(join(AUDIO, 'cover.png'))));
  });

  it('prefers the front cover to other pictures, and reads ID3v2.2’s PIC', () => {
    const png = [0x89, ...ascii('PNG'), 1, 2, 3];
    const jpeg = [0xff, 0xd8, 0xff, 4, 5];
    const apic = (type: number, data: number[]) => [
      0,
      ...ascii('image/jpg'),
      0,
      type,
      ...ascii('d'),
      0,
      ...data,
    ];
    const tag = (version: number, frames: [string, number[]][]) => {
      const idLength = version === 2 ? 3 : 4;
      const body = frames.flatMap(([id, b]) =>
        version === 2
          ? [...ascii(id), 0, (b.length >> 8) & 0xff, b.length & 0xff, ...b]
          : [...ascii(id.padEnd(idLength)), 0, 0, (b.length >> 8) & 0xff, b.length & 0xff, 0, 0, ...b],
      );
      const n = body.length;
      return new Uint8Array([...ascii('ID3'), version, 0, 0, 0, 0, (n >> 7) & 0x7f, n & 0x7f, ...body]);
    };
    const v3 = parseId3v2(
      tag(3, [
        ['APIC', apic(4, png)],
        ['APIC', apic(3, jpeg)],
      ]),
    )!;
    expect(v3.pictures.map((p) => [p.type, p.mime])).toEqual([
      [4, 'image/png'],
      [3, 'image/jpeg'],
    ]);
    const v2 = parseId3v2(tag(2, [['PIC', [0, ...ascii('PNG'), 3, 0, ...png]]]))!;
    expect(v2.pictures[0]).toMatchObject({ mime: 'image/png', type: 3 });
  });

  it('skips an APE tag at the end of an MP3 when working out its length', async () => {
    const plain = new Uint8Array(await readFile(join(AUDIO, 'cbr-no-xing.mp3')));
    const items = new Uint8Array(200).fill(0xff);
    const footer = new Uint8Array(32);
    footer.set(ascii('APETAGEX'));
    new DataView(footer.buffer).setUint32(12, items.length + 32, true);
    const tagged = new Uint8Array([...plain, ...items, ...footer]);
    const a = await readTags(memorySource(plain), 'a.mp3');
    const b = await readTags(memorySource(tagged), 'b.mp3');
    expect(a.ok && b.ok && b.stream.duration).toBe(a.ok && a.stream.duration);
  });

  it('reads Opus R128 gains and Ogg METADATA_BLOCK_PICTURE fields', () => {
    const png = [0x89, ...ascii('PNG'), 9];
    const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    const block = [
      ...u32(3),
      ...u32(9),
      ...ascii('image/png'),
      ...u32(0),
      ...u32(8),
      ...u32(8),
      ...u32(24),
      ...u32(0),
      ...u32(png.length),
      ...png,
    ];
    const entries = [
      'R128_TRACK_GAIN=-1280',
      'R128_ALBUM_GAIN=256',
      `METADATA_BLOCK_PICTURE=${btoa(String.fromCharCode(...block))}`,
    ];
    const le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
    const body = new Uint8Array([
      ...le(0),
      ...le(entries.length),
      ...entries.flatMap((e) => [...le(e.length), ...ascii(e)]),
    ]);
    const comments = parseVorbisComment(body)!;
    // −1280/256 = −5 dB toward −23 LUFS is 0 dB toward ReplayGain's −18.
    expect(vorbisTags(comments).replayGain).toEqual({ trackGain: 0, albumGain: 6 });
    expect(vorbisPictures(comments)).toEqual([{ mime: 'image/png', type: 3, data: new Uint8Array(png) }]);
  });

  it('decodes base64 and names pictures by their SHA-256', () => {
    expect(Array.from(decodeBase64('AQID\n/w==')!)).toEqual([1, 2, 3, 255]);
    expect(decodeBase64('not base64!')).toBeNull();
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    // 56 bytes: the padding spills into a second block.
    expect(
      sha256Hex(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
});

describe('covers in a scan', () => {
  it('stores each picture once and falls back to the folder’s image', async () => {
    const stored: [string, Picture][] = [];
    const songs = await scanLibrary(folderSource(LIBRARY), { onCover: (id, p) => void stored.push([id, p]) });
    const bloom = songs.find((s) => s.title === 'Static Bloom')!;
    expect(bloom.cover).toEqual({ kind: 'file', path: 'Paper Kites Club/Small Hours/cover.jpg' });
    expect(songs.find((s) => s.title === 'Morning Tide')!.cover).toBeUndefined();
    expect(stored).toEqual([]);
  });

  it('names an embedded cover by its hash and keeps it over a folder image', async () => {
    const files = [
      { path: 'A/one.mp3', size: 1, mtime: 1 },
      { path: 'A/two.mp3', size: 2, mtime: 1 },
      { path: 'A/folder.png', size: 3, mtime: 1 },
    ];
    const bytes = new Uint8Array(await readFile(join(AUDIO, 'apic.mp3')));
    const stored: string[] = [];
    const songs = await scanLibrary(
      { list: () => Promise.resolve(files), open: () => Promise.resolve(memorySource(bytes)) },
      { onCover: (id) => void stored.push(id) },
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^[0-9a-f]{64}$/);
    for (const s of songs) expect(s.cover).toEqual({ kind: 'embedded', id: stored[0], mime: 'image/png' });
    expect(coverIds(songs)).toEqual(new Set(stored));
  });
});

describe('the index', () => {
  const song = (path: string, extra: Partial<Song> = {}): Song => ({
    path,
    size: 10,
    mtime: 1,
    format: 'mp3',
    codec: 'mp3',
    title: 'T',
    artist: 'A',
    album: 'B',
    albumArtist: 'A',
    compilation: false,
    duration: 3,
    sampleRate: 44100,
    channels: 2,
    ...extra,
  });

  it('reads back what it wrote, and throws away anything else', () => {
    const index = makeIndex('/Music', [song('a.mp3')], new Date('2026-01-02T03:04:05Z'));
    const text = JSON.stringify(index);
    expect(parseIndex(text, '/Music')).toEqual(index);
    expect(parseIndex(text, '/Other')).toBeNull();
    expect(parseIndex('{"format":2,"root":"/Music","scannedAt":"x","songs":[]}', '/Music')).toBeNull();
    expect(parseIndex('{not json', '/Music')).toBeNull();
    expect(
      parseIndex('{"format":1,"root":"/Music","scannedAt":"x","songs":[{"path":1}]}', '/Music'),
    ).toBeNull();
  });

  it('finds songs that moved, and only the ones it can be sure of', () => {
    const before = [
      song('old/a.mp3', { title: 'A' }),
      song('old/b.mp3', { title: 'B' }),
      song('old/c.mp3', { title: 'C' }),
    ];
    const after = [
      song('new/a.mp3', { title: 'A' }),
      song('new/b.mp3', { title: 'B', size: 11 }),
      song('new/c1.mp3', { title: 'C' }),
      song('new/c2.mp3', { title: 'C' }),
    ];
    expect(findMoves(before, after)).toEqual(new Map([['old/a.mp3', 'new/a.mp3']]));
  });
});
