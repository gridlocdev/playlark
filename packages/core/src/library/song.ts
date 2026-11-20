/** A song in the library: one music file's tags and stream facts, with fallbacks for what the tags leave out (PRD §4.4). */
import type { AudioFormat, Codec, Tags } from '../tags/types.ts';
import { type LibraryFile, stem } from './files.ts';

export const UNKNOWN_ARTIST = 'Unknown Artist';
export const UNKNOWN_ALBUM = 'Unknown Album';

export interface Song {
  /** Relative path in the library folder: the song's id everywhere. */
  readonly path: string;
  readonly size: number;
  readonly mtime: number;
  readonly format: AudioFormat | null;
  readonly codec: Codec;
  /** Never empty: the file name when the tags have no title. */
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  /** The album artist, else the artist: what albums group by. */
  readonly albumArtist: string;
  readonly track?: number;
  readonly trackTotal?: number;
  readonly disc?: number;
  readonly discTotal?: number;
  readonly year?: number;
  readonly genre?: string;
  readonly compilation: boolean;
  /** Seconds. */
  readonly duration: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitrate?: number;
  readonly bitsPerSample?: number;
  readonly encoderDelay?: number;
  readonly encoderPadding?: number;
  /** Why the file couldn't be read, when it couldn't; the song still shows, greyed. */
  readonly error?: string;
}

interface Read {
  readonly format: AudioFormat;
  readonly tags: Tags;
  readonly stream: {
    codec: Codec;
    duration: number;
    sampleRate: number;
    channels: number;
    bitrate?: number;
    bitsPerSample?: number;
    encoderDelay?: number;
    encoderPadding?: number;
  };
}

/** The song for a file that read cleanly. */
export function songFrom(file: LibraryFile, read: Read): Song {
  const { tags, stream } = read;
  const artist = tags.artist ?? UNKNOWN_ARTIST;
  return {
    path: file.path,
    size: file.size,
    mtime: file.mtime,
    format: read.format,
    codec: stream.codec,
    title: tags.title ?? stem(file.path),
    artist,
    album: tags.album ?? UNKNOWN_ALBUM,
    albumArtist: tags.albumArtist ?? (tags.compilation ? 'Various Artists' : artist),
    ...(tags.track !== undefined ? { track: tags.track } : {}),
    ...(tags.trackTotal !== undefined ? { trackTotal: tags.trackTotal } : {}),
    ...(tags.disc !== undefined ? { disc: tags.disc } : {}),
    ...(tags.discTotal !== undefined ? { discTotal: tags.discTotal } : {}),
    ...(tags.year !== undefined ? { year: tags.year } : {}),
    ...(tags.genre !== undefined ? { genre: tags.genre } : {}),
    compilation: tags.compilation ?? false,
    duration: stream.duration,
    sampleRate: stream.sampleRate,
    channels: stream.channels,
    ...(stream.bitrate !== undefined ? { bitrate: stream.bitrate } : {}),
    ...(stream.bitsPerSample !== undefined ? { bitsPerSample: stream.bitsPerSample } : {}),
    ...(stream.encoderDelay !== undefined ? { encoderDelay: stream.encoderDelay } : {}),
    ...(stream.encoderPadding !== undefined ? { encoderPadding: stream.encoderPadding } : {}),
  };
}

/** The song for a file that couldn't be read: listed by its file name with the reason. */
export function unreadableSong(file: LibraryFile, format: AudioFormat | null, error: string): Song {
  return {
    path: file.path,
    size: file.size,
    mtime: file.mtime,
    format,
    codec: 'unknown',
    title: stem(file.path),
    artist: UNKNOWN_ARTIST,
    album: UNKNOWN_ALBUM,
    albumArtist: UNKNOWN_ARTIST,
    compilation: false,
    duration: 0,
    sampleRate: 0,
    channels: 0,
    error,
  };
}
