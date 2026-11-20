import { describe, expect, it } from 'vitest';
import {
  type LibraryFile,
  type ScanSource,
  isMusicPath,
  memorySource,
  scanLibrary,
  sortKey,
} from '../src/index.ts';
import { LIBRARY, folderSource } from './helpers.ts';

describe('scanning the library folder', () => {
  it('lists every music file, sorted, skipping hidden folders and other files', async () => {
    const songs = await scanLibrary(folderSource(LIBRARY));
    expect(songs.map((s) => s.path)).toEqual([
      'Field Recordings/rain-on-tin.wav',
      'Northwind Quartet/Harbour Lights/01 Morning Tide.mp3',
      'Northwind Quartet/Harbour Lights/02 Salt Air.flac',
      'Northwind Quartet/Harbour Lights/03 Lantern Walk.m4a',
      'Paper Kites Club/Small Hours/1-01 Static Bloom.ogg',
      'Paper Kites Club/Small Hours/2-01 Night Bus.opus',
      'Loose/untagged.mp3',
    ]);
  });

  it('fills in what the tags leave out', async () => {
    const songs = await scanLibrary(folderSource(LIBRARY));
    const untagged = songs.find((s) => s.path === 'Loose/untagged.mp3')!;
    expect(untagged).toMatchObject({ title: 'untagged', artist: 'Unknown Artist', album: 'Unknown Album' });
    const bloom = songs.find((s) => s.title === 'Static Bloom')!;
    expect(bloom.albumArtist).toBe('Paper Kites Club');
  });

  it('reports progress and reuses songs whose files haven’t changed', async () => {
    const source = folderSource(LIBRARY);
    const first = await scanLibrary(source);
    let opened = 0;
    const counting: ScanSource = { list: source.list, open: (f) => (opened++, source.open(f)) };
    const progress: number[] = [];
    const second = await scanLibrary(counting, { previous: first, onProgress: (p) => progress.push(p.done) });
    expect(opened).toBe(0);
    expect(second).toEqual(first);
    expect(progress.at(-1)).toBe(7);
  });

  it('keeps a file it can’t read, with the reason', async () => {
    const files: LibraryFile[] = [{ path: 'broken.flac', size: 4, mtime: 1 }];
    const source: ScanSource = {
      list: () => Promise.resolve(files),
      open: () => Promise.resolve(memorySource(new TextEncoder().encode('fLaC'))),
    };
    const [song] = await scanLibrary(source);
    expect(song).toMatchObject({ title: 'broken', format: 'flac', duration: 0 });
    expect(song!.error).toMatch(/ends inside/);
  });

  it('decides which paths are music', () => {
    expect(isMusicPath('A/b.MP3')).toBe(true);
    expect(isMusicPath('A/.b.mp3')).toBe(false);
    expect(isMusicPath('@eaDir/b.mp3')).toBe(false);
    expect(isMusicPath('A/cover.jpg')).toBe(false);
    expect(sortKey('The Beatles')).toBe('Beatles');
  });
});
