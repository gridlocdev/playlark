import { describe, expect, it } from 'vitest';
import {
  type Song,
  buildLibrary,
  fold,
  prepareSearch,
  search,
  songsUnder,
  sortSongsBy,
} from '../src/index.ts';

let n = 0;
function song(path: string, extra: Partial<Song> = {}): Song {
  n++;
  return {
    path,
    size: n,
    mtime: 1,
    format: 'mp3',
    codec: 'mp3',
    title: path,
    artist: 'A',
    album: 'B',
    albumArtist: extra.artist ?? 'A',
    compilation: false,
    duration: n,
    sampleRate: 44100,
    channels: 2,
    ...extra,
  };
}

const SONGS = [
  song('Beatles/Abbey/02 Something.mp3', {
    title: 'Something',
    artist: 'The Beatles',
    album: 'Abbey Road',
    track: 2,
    year: 1969,
    genre: 'Rock',
  }),
  song('Beatles/Abbey/01 Come Together.mp3', {
    title: 'Come Together',
    artist: 'The Beatles',
    album: 'abbey road',
    track: 1,
    year: 1969,
    cover: { kind: 'file', path: 'Beatles/Abbey/cover.jpg' },
  }),
  song('Beatles/Abbey/bonus.mp3', { title: 'Bonus', artist: 'The Beatles', album: 'Abbey Road', year: 2019 }),
  song('Beatles/Help/01 Help.mp3', { title: 'Help!', artist: 'The Beatles', album: 'Help!', year: 1965 }),
  song('Mixes/01 Café.mp3', {
    title: 'Café',
    artist: 'The Beatles',
    albumArtist: 'Various Artists',
    album: 'Mix',
    compilation: true,
    disc: 2,
    track: 1,
  }),
  song('Mixes/02 Other.mp3', {
    title: 'Other',
    artist: 'Zed',
    albumArtist: 'Various Artists',
    album: 'Mix',
    compilation: true,
    disc: 1,
    track: 5,
  }),
  song('Loose/bad.flac', { error: 'Bad header.', title: 'bad' }),
];

describe('albums and artists', () => {
  const lib = buildLibrary(SONGS);

  it('joins albums that differ only in case, and orders their songs by disc, track and file name', () => {
    const abbey = lib.albums.find((a) => a.title.toLowerCase() === 'abbey road')!;
    expect(abbey.songs.map((s) => s.title)).toEqual(['Come Together', 'Something', 'Bonus']);
    expect(abbey.year).toBe(1969);
    expect(abbey.cover).toEqual({ kind: 'file', path: 'Beatles/Abbey/cover.jpg' });
    const mix = lib.albums.find((a) => a.title === 'Mix')!;
    expect(mix.discs).toBe(2);
    expect(mix.songs.map((s) => s.title)).toEqual(['Other', 'Café']);
    expect(lib.albumOf.get('Mixes/01 Café.mp3')).toBe(mix);
  });

  it('lists album artists with "The" ignored, newest albums first, and where else they appear', () => {
    expect(lib.artists.map((a) => a.name)).toEqual(['The Beatles', 'Various Artists']);
    const beatles = lib.artistByKey.get(fold('The Beatles'))!;
    expect(beatles.albums.map((a) => a.title)).toEqual(['abbey road', 'Help!']);
    expect(beatles.appearsOn.map((a) => a.title)).toEqual(['Mix']);
    // Unreadable songs are on no album.
    expect(lib.albums.flatMap((a) => a.songs).some((s) => s.error)).toBe(false);
  });

  it('sorts albums by album artist, year and title', () => {
    expect(lib.albums.map((a) => [a.artist, a.year ?? 0])).toEqual([
      ['The Beatles', 1965],
      ['The Beatles', 1969],
      ['Various Artists', 0],
    ]);
  });

  it('uses sort-name tags when present', () => {
    const tagged = buildLibrary([
      song('a.mp3', { artist: 'Zappa', albumArtistSort: 'Aardvark' }),
      song('b.mp3', { artist: 'Moby' }),
    ]);
    expect(tagged.artists.map((a) => a.name)).toEqual(['Zappa', 'Moby']);
  });

  it('builds the folder tree, folders first, songs by file name', () => {
    expect(lib.root.folders.map((f) => f.name)).toEqual(['Beatles', 'Loose', 'Mixes']);
    const abbey = lib.folderByPath.get('Beatles/Abbey')!;
    expect(abbey.songs.map((s) => s.title)).toEqual(['Come Together', 'Something', 'Bonus']);
    expect(songsUnder(lib.folderByPath.get('Beatles')!).map((s) => s.title)).toEqual([
      'Come Together',
      'Something',
      'Bonus',
      'Help!',
    ]);
  });
});

describe('sorting the Songs table', () => {
  it('sorts by a column, ties in the default order, and reverses', () => {
    const songs = SONGS.filter((s) => !s.error);
    expect(sortSongsBy(songs, 'title').map((s) => s.title)).toEqual([
      'Bonus',
      'Café',
      'Come Together',
      'Help!',
      'Other',
      'Something',
    ]);
    expect(sortSongsBy(songs, 'title', true)[0]!.title).toBe('Something');
    expect(sortSongsBy(songs, null).map((s) => s.title)).toEqual([
      'Come Together',
      'Something',
      'Bonus',
      'Help!',
      'Other',
      'Café',
    ]);
  });
});

describe('search', () => {
  const index = prepareSearch(buildLibrary(SONGS));

  it('matches the start of words in any field, every word, ignoring case and accents', () => {
    const r = search(index, 'beat abb');
    expect(r.songs.map((s) => s.title)).toEqual(['Come Together', 'Something', 'Bonus']);
    expect(r.albums.map((a) => a.title)).toEqual(['abbey road']);
    expect(r.artists).toEqual([]);
    expect(search(index, 'CAFE').songs.map((s) => s.title)).toEqual(['Café']);
    expect(search(index, 'rock').songs.map((s) => s.title)).toEqual(['Something']);
    expect(search(index, 'eatles').songs).toEqual([]);
    expect(search(index, 'beatles').artists.map((a) => a.name)).toEqual(['The Beatles']);
    expect(search(index, '  ').songs).toEqual([]);
  });

  it('finds songs by their file name', () => {
    expect(search(index, 'bad').songs.map((s) => s.path)).toEqual(['Loose/bad.flac']);
  });
});
