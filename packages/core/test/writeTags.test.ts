import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Picture,
  type TagEdit,
  TagCheckError,
  applyEdit,
  memorySource,
  parseTagEdit,
  readTags,
  rewriteTags,
} from '../src/index.ts';
import { AUDIO, LIBRARY } from './helpers.ts';

const bytes = async (path: string) => new Uint8Array(await readFile(path));
const read = async (b: Uint8Array, path: string) => {
  const r = await readTags(memorySource(b), path);
  if (!r.ok) throw new Error(r.error);
  return r;
};

const PNG = async (): Promise<Picture> => ({
  mime: 'image/png',
  type: 3,
  data: await bytes(join(AUDIO, 'cover.png')),
});
const JPEG = async (): Promise<Picture> => ({
  mime: 'image/jpeg',
  type: 3,
  data: await bytes(join(LIBRARY, 'Paper Kites Club/Small Hours/cover.jpg')),
});

const FILES = [
  ['ID3v2.4', join(LIBRARY, 'Northwind Quartet/Harbour Lights/01 Morning Tide.mp3')],
  ['ID3v2.3', join(AUDIO, 'id3v23.mp3')],
  ['MP3 with a cover', join(AUDIO, 'apic.mp3')],
  ['MP3 with no tags', join(LIBRARY, 'Loose/untagged.mp3')],
  ['FLAC', join(LIBRARY, 'Northwind Quartet/Harbour Lights/02 Salt Air.flac')],
  ['FLAC with a picture', join(AUDIO, 'picture.flac')],
  ['M4A, header at the end', join(LIBRARY, 'Northwind Quartet/Harbour Lights/03 Lantern Walk.m4a')],
  ['M4A with a cover', join(AUDIO, 'covr.m4a')],
  ['M4A, header first', join(AUDIO, 'faststart.m4a')],
  ['ALAC', join(AUDIO, 'alac.m4a')],
] as const;

const EVERYTHING = async (): Promise<TagEdit> => ({
  title: 'Nuevo Título ✓',
  artist: 'Ünïcode Artist',
  album: 'An Album',
  albumArtist: 'Various',
  genre: 'Jazz',
  track: 4,
  trackTotal: 11,
  disc: 2,
  discTotal: 3,
  year: 1999,
  compilation: true,
  cover: await JPEG(),
});

describe('writing tags (§11.2)', () => {
  for (const [what, path] of FILES) {
    it(`${what}: writes every field, keeps the audio, and Undo puts the old tags back`, async () => {
      const original = await bytes(path);
      const before = await read(original, path);
      const edit = await EVERYTHING();
      const { bytes: written, undo } = await rewriteTags(original, path, edit);
      expect(written).not.toBeNull();
      const after = await read(written!, path);
      const expected = applyEdit(before, edit);
      expect(after.tags).toEqual(expected.tags);
      expect(after.cover?.data).toEqual(edit.cover!.data);
      expect(after.stream).toEqual(before.stream);

      // A second, smaller edit fits in the padding the first left, so the audio doesn't move.
      const second = await rewriteTags(written!, path, { title: 'Short' });
      expect(second.bytes!.length).toBe(written!.length);

      const back = await rewriteTags(written!, path, undo);
      const restored = await read(back.bytes!, path);
      expect(restored.tags).toEqual(before.tags);
      expect(restored.cover?.data).toEqual(before.cover?.data);
    });
  }

  it('changes only the fields the edit names', async () => {
    const path = join(AUDIO, 'id3v23.mp3');
    const before = await read(await bytes(path), path);
    const { bytes: written } = await rewriteTags(await bytes(path), path, { album: 'Elsewhere' });
    const after = await read(written!, path);
    expect(after.tags).toEqual({ ...before.tags, album: 'Elsewhere' });
    expect(written![3], 'an ID3v2.3 tag stays 2.3').toBe(3);
  });

  it('takes fields and the cover out', async () => {
    const path = join(AUDIO, 'apic.mp3');
    const before = await read(await bytes(path), path);
    expect(before.cover).toBeDefined();
    const { bytes: written } = await rewriteTags(await bytes(path), path, { title: '  ', cover: null });
    const after = await read(written!, path);
    expect(after.tags.title).toBeUndefined();
    expect(after.cover).toBeUndefined();
  });

  it('a new MP3 tag is ID3v2.4, and an ID3v1 tag at the end is updated too', async () => {
    const path = join(LIBRARY, 'Loose/untagged.mp3');
    const v1 = new Uint8Array(128);
    v1.set(Array.from('TAG', (c) => c.charCodeAt(0)));
    v1.set(
      Array.from('Old Title', (c) => c.charCodeAt(0)),
      3,
    );
    v1[127] = 255;
    const original = new Uint8Array([...(await bytes(path)), ...v1]);
    const { bytes: written } = await rewriteTags(original, path, {
      title: 'A title much longer than thirty characters fits in v2',
      genre: 'Rock',
    });
    expect(String.fromCharCode(...written!.subarray(0, 4))).toBe('ID3\x04');
    const tail = written!.subarray(written!.length - 128);
    expect(String.fromCharCode(...tail.subarray(3, 33))).toBe('A title much longer than thirt');
    expect(tail[127], 'Rock is genre 17').toBe(17);
  });

  it('a PNG cover goes into FLAC and M4A files too', async () => {
    for (const path of [FILES[4][1], join(AUDIO, 'faststart.m4a')]) {
      const cover = await PNG();
      const { bytes: written } = await rewriteTags(await bytes(path), path, { cover });
      expect((await read(written!, path)).cover).toMatchObject({ mime: 'image/png', data: cover.data });
    }
  });

  it('an edit that changes nothing writes nothing', async () => {
    const path = join(AUDIO, 'id3v23.mp3');
    const before = await read(await bytes(path), path);
    const { bytes: written } = await rewriteTags(await bytes(path), path, {
      title: ` ${before.tags.title!} `,
    });
    expect(written).toBeNull();
  });
});

describe('the check after writing (§11.3)', () => {
  it('refuses a file whose tags don’t read back as written', async () => {
    const path = join(AUDIO, 'id3v23.mp3');
    // ID3 reads "(17)" as genre 17, Rock: not what was asked for, so the new bytes are thrown away.
    await expect(rewriteTags(await bytes(path), path, { genre: '(17)' })).rejects.toBeInstanceOf(
      TagCheckError,
    );
  });

  it('says which formats it can’t edit yet', async () => {
    const path = join(AUDIO, 'stereo.opus');
    await expect(rewriteTags(await bytes(path), path, { title: 'x' })).rejects.toThrow(/OGG files/);
  });
});

describe('an edit from IPC or HTTP', () => {
  it('takes the fields with the right types, and a cover as bytes or base64', () => {
    const png = { mime: 'image/png', data: 'iVBORw==' };
    expect(parseTagEdit({ title: 'A', year: null, compilation: true, cover: png })).toEqual({
      title: 'A',
      year: null,
      compilation: true,
      cover: { mime: 'image/png', type: 3, data: Uint8Array.of(0x89, 0x50, 0x4e, 0x47) },
    });
    expect(parseTagEdit({ cover: { mime: 'image/jpeg', data: Uint8Array.of(1) } })?.cover?.data).toEqual(
      Uint8Array.of(1),
    );
    expect(parseTagEdit({ cover: null })).toEqual({ cover: null });
  });

  it('refuses anything else', () => {
    for (const bad of [
      null,
      [],
      'x',
      { title: 3 },
      { year: '1999' },
      { compilation: 1 },
      { cover: { mime: 'image/gif', data: '' } },
      { cover: { mime: 'image/png', data: [1, 2] } },
      { comment: 'x' },
      { title: 'x'.repeat(10_001) },
    ])
      expect(parseTagEdit(bad), JSON.stringify(bad)).toBeNull();
  });
});
