import { describe, expect, it } from 'vitest';
import {
  type PlaylistFile,
  type Song,
  addEntries,
  isLibraryPath,
  isMusicPath,
  isPlaylistPath,
  moveEntries,
  newPlaylistPath,
  parsePlaylist,
  playlistName,
  random,
  relativePath,
  removeEntries,
  renamedPath,
  safeName,
  sameEntries,
  writePlaylist,
} from '../src/index.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const paths = (f: PlaylistFile) => f.entries.map((e) => e.path);

const song = (path: string, title: string, artist: string, duration: number): Song =>
  ({ path, title, artist, duration }) as Song;

describe('playlist files', () => {
  it('lists .m3u8 and .m3u files outside hidden folders, and never scans them as music', () => {
    expect(isPlaylistPath('Playlists/Road Trip.m3u8')).toBe(true);
    expect(isPlaylistPath('old/MIX.M3U')).toBe(true);
    expect(isPlaylistPath('.hidden/x.m3u8')).toBe(false);
    expect(isPlaylistPath('a.m3u8.bak')).toBe(false);
    expect(isLibraryPath('Playlists/Road Trip.m3u8')).toBe(true);
    expect(isMusicPath('Playlists/Road Trip.m3u8')).toBe(false);
    expect(playlistName('Playlists/Road Trip.m3u8')).toBe('Road Trip');
  });

  it('reads relative, backslash, absolute, file:// and percent-encoded entries, with a BOM and CRLF', () => {
    const text =
      '\uFEFF#EXTM3U\r\n#EXTINF:120,A - One\r\n../Artist/Album/01 One.mp3\r\n' +
      '..\\Artist\\Album\\02 Two.flac\r\n' +
      '/Users/me/Music/Artist/Album/03 Three.m4a\r\n' +
      'file:///Users/me/Music/Artist/Album/04%20Four.ogg\r\n' +
      '../Artist/Album/05%20Five.mp3\r\n' +
      '/Volumes/Other/elsewhere.mp3\r\n' +
      '../../outside.mp3\r\n';
    const exists = (p: string) => p === 'Artist/Album/05 Five.mp3';
    const f = parsePlaylist(enc(text), 'Playlists/Mix.m3u8', '/Users/me/Music', exists);
    expect(f.encoding).toBe('utf-8');
    expect(paths(f)).toEqual([
      'Artist/Album/01 One.mp3',
      'Artist/Album/02 Two.flac',
      'Artist/Album/03 Three.m4a',
      'Artist/Album/04 Four.ogg',
      'Artist/Album/05 Five.mp3',
      null,
      null,
    ]);
    expect(f.entries[0]!.extinf).toBe('#EXTINF:120,A - One');
  });

  it('reads Windows drive paths inside the folder, ignoring case', () => {
    const f = parsePlaylist(enc('C:\\Music\\A\\b.mp3\nc:/music/A/c.mp3\n'), 'x.m3u', 'C:\\Music');
    expect(paths(f)).toEqual(['A/b.mp3', 'A/c.mp3']);
  });

  it('reads an .m3u that isn’t UTF-8 as Windows-1252 and writes it back the same', () => {
    const bytes = Uint8Array.from([
      ...enc('#EXTM3U\nCaf'),
      0xe9,
      ...enc(' ‚'.slice(0, 1)),
      0x80,
      ...enc('.mp3\n'),
    ]);
    const f = parsePlaylist(bytes, 'old.m3u');
    expect(f.encoding).toBe('windows-1252');
    expect(f.entries[0]!.path).toBe('Café €.mp3');
    expect(writePlaylist(f, 'old.m3u', () => undefined)).toEqual(bytes);
  });

  it('keeps other # lines before the entry they came before, and at the end', () => {
    const f = parsePlaylist(enc('#EXTM3U\n#PLAYLIST:Mine\na.mp3\n#EXTGRP:x\nb.mp3\n# the end\n'), 'p.m3u8');
    expect(f.entries.map((e) => e.comments)).toEqual([['#PLAYLIST:Mine'], ['#EXTGRP:x']]);
    expect(f.trailing).toEqual(['# the end']);
  });

  it('writes #EXTM3U, #EXTINF from the song and paths relative to the playlist, with LF and no BOM', () => {
    const songs = new Map([
      ['Artist/Album/01 One.mp3', song('Artist/Album/01 One.mp3', 'One', 'Artist', 61.6)],
    ]);
    let f = parsePlaylist(enc('#EXTM3U\r\n#EXTINF:5,Old - Name\r\n..\\Gone.mp3\r\n'), 'Playlists/Mix.m3u8');
    f = addEntries(f, 'Playlists/Mix.m3u8', ['Artist/Album/01 One.mp3']);
    expect(dec(writePlaylist(f, 'Playlists/Mix.m3u8', (p) => songs.get(p)))).toBe(
      '#EXTM3U\n#EXTINF:5,Old - Name\n../Gone.mp3\n#EXTINF:62,Artist - One\n../Artist/Album/01 One.mp3\n',
    );
  });

  it('round-trips: what is written reads back as the same entries, for any edits', () => {
    const library = [
      'A/1.mp3',
      'A/2.flac',
      'B/C/3.ogg',
      'Top.wav',
      'Playlists/In.m3u8.mp3',
      'Ünï cødé/4.m4a',
    ];
    const roll = random(7);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(roll() * xs.length)]!;
    for (const at of ['Playlists/P.m3u8', 'P.m3u8', 'A/Deep/P.m3u']) {
      let f: PlaylistFile = { entries: [], trailing: [], encoding: 'utf-8' };
      for (let step = 0; step < 200; step++) {
        const n = f.entries.length;
        const op = pick(['add', 'add', 'remove', 'move'] as const);
        if (op === 'add') f = addEntries(f, at, [pick(library)]);
        else if (op === 'remove' && n > 0) f = removeEntries(f, [Math.floor(roll() * n)]);
        else if (n > 0) f = moveEntries(f, [Math.floor(roll() * n)], Math.floor(roll() * (n + 1)));
        const back = parsePlaylist(
          writePlaylist(f, at, () => undefined),
          at,
        );
        expect(paths(back)).toEqual(paths(f));
      }
    }
  });
});

describe('editing a playlist', () => {
  const at = 'Playlists/P.m3u8';
  const base = addEntries({ entries: [], trailing: [], encoding: 'utf-8' }, at, ['a', 'b', 'c', 'd']);

  it('moves entries to a gap, keeping their order', () => {
    expect(paths(moveEntries(base, [3], 0))).toEqual(['d', 'a', 'b', 'c']);
    expect(paths(moveEntries(base, [0], 4))).toEqual(['b', 'c', 'd', 'a']);
    expect(paths(moveEntries(base, [0, 2], 4))).toEqual(['b', 'd', 'a', 'c']);
    expect(paths(moveEntries(base, [1, 3], 1))).toEqual(['a', 'b', 'd', 'c']);
    expect(moveEntries(base, [1], 1)).toBe(base);
    expect(moveEntries(base, [1], 2)).toBe(base);
  });

  it('removes entries and keeps their comments with the next one', () => {
    const f = { ...base, entries: base.entries.map((e, i) => ({ ...e, comments: [`#${i}`] })) };
    const r = removeEntries(f, [1, 3]);
    expect(paths(r)).toEqual(['a', 'c']);
    expect(r.entries[1]!.comments).toEqual(['#1', '#2']);
    expect(r.trailing).toEqual(['#3']);
    expect(removeEntries(base, [9])).toBe(base);
  });

  it('allows duplicates, and sees an edit that changes nothing', () => {
    const twice = addEntries(base, at, ['a']);
    expect(paths(twice)).toEqual(['a', 'b', 'c', 'd', 'a']);
    expect(sameEntries(base, { ...base, entries: [...base.entries] })).toBe(true);
    expect(sameEntries(base, twice)).toBe(false);
  });

  it('names new playlists safely in Playlists/, adding a number when taken', () => {
    expect(safeName('AC/DC: Best?')).toBe('AC-DC- Best-');
    expect(safeName(' ..  ')).toBe('Playlist');
    expect(newPlaylistPath('New Playlist', new Set())).toBe('Playlists/New Playlist.m3u8');
    const taken = new Set(['Playlists/new playlist.m3u8', 'Playlists/New Playlist 2.m3u8']);
    expect(newPlaylistPath('New Playlist', taken)).toBe('Playlists/New Playlist 3.m3u8');
    expect(renamedPath('old/Mix.m3u', 'Road', new Set(['old/Mix.m3u']))).toBe('old/Road.m3u');
    expect(renamedPath('Mix.m3u8', 'mix', new Set(['Mix.m3u8']))).toBe('mix.m3u8');
  });

  it('writes paths relative to the playlist folder', () => {
    expect(relativePath('Playlists', 'A/b.mp3')).toBe('../A/b.mp3');
    expect(relativePath('', 'A/b.mp3')).toBe('A/b.mp3');
    expect(relativePath('A/B', 'A/c.mp3')).toBe('../c.mp3');
    expect(relativePath('A', 'A/B/c.mp3')).toBe('B/c.mp3');
  });
});
