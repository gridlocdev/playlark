/** Vorbis comments (PRD §4.1): the tags in FLAC, Ogg Vorbis and Opus files. */
import { decodeUtf8, u32le } from '../bytes.ts';
import { decodeBase64, parseFlacPicture } from './picture.ts';
import {
  type Picture,
  type Tags,
  parseFlag,
  parseYear,
  replayGainFrom,
  setPair,
  setText,
  setTotal,
} from './types.ts';

/** The comment fields by upper-case name; repeated fields keep every value in order. */
export type Comments = ReadonlyMap<string, readonly string[]>;

/** Parses a comment block (vendor string, count, then `NAME=value` entries), or null when it's cut short. */
export function parseVorbisComment(b: Uint8Array): Comments | null {
  let at = 0;
  if (b.length < 8) return null;
  const vendor = u32le(b, at);
  at += 4 + vendor;
  if (at + 4 > b.length) return null;
  const count = u32le(b, at);
  at += 4;
  const out = new Map<string, string[]>();
  for (let i = 0; i < count; i++) {
    if (at + 4 > b.length) break;
    const length = u32le(b, at);
    at += 4;
    if (at + length > b.length) break;
    const entry = decodeUtf8(b.subarray(at, at + length));
    at += length;
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const name = entry.slice(0, eq).toUpperCase();
    const list = out.get(name) ?? [];
    list.push(entry.slice(eq + 1));
    out.set(name, list);
  }
  return out;
}

/** The fields Playlark uses. Several artists or genres are joined with ", ". */
export function vorbisTags(c: Comments): Tags {
  const all = (name: string) => {
    const v = c
      .get(name)
      ?.map((s) => s.trim())
      .filter(Boolean);
    return v && v.length > 0 ? v.join(', ') : undefined;
  };
  const first = (...names: string[]) => {
    for (const n of names) {
      const v = c.get(n)?.[0];
      if (v !== undefined && v.trim()) return v;
    }
    return undefined;
  };
  const tags: Tags = {};
  setText(tags, 'title', all('TITLE'));
  setText(tags, 'artist', all('ARTIST'));
  setText(tags, 'album', first('ALBUM'));
  setText(tags, 'albumArtist', first('ALBUMARTIST', 'ALBUM ARTIST', 'ALBUM_ARTIST'));
  setPair(tags, 'track', first('TRACKNUMBER', 'TRACK'));
  setPair(tags, 'disc', first('DISCNUMBER', 'DISC'));
  setTotal(tags, 'trackTotal', first('TRACKTOTAL', 'TOTALTRACKS'));
  setTotal(tags, 'discTotal', first('DISCTOTAL', 'TOTALDISCS'));
  const year = parseYear(first('DATE', 'YEAR', 'ORIGINALDATE'));
  if (year !== undefined) tags.year = year;
  setText(tags, 'genre', all('GENRE'));
  const compilation = parseFlag(first('COMPILATION'));
  if (compilation !== undefined) tags.compilation = compilation;
  setText(tags, 'artistSort', first('ARTISTSORT'));
  setText(tags, 'albumArtistSort', first('ALBUMARTISTSORT'));
  setText(tags, 'albumSort', first('ALBUMSORT'));
  setText(tags, 'titleSort', first('TITLESORT'));
  const replayGain = replayGainFrom((key) => first(`REPLAYGAIN_${key}`)) ?? r128Gain(c);
  if (replayGain) tags.replayGain = replayGain;
  return tags;
}

/**
 * Opus' `R128_TRACK_GAIN` and `R128_ALBUM_GAIN`: whole numbers in 1/256 dB toward −23 LUFS. ReplayGain aims at
 * −18 LUFS, 5 dB louder, so 5 dB is added.
 */
function r128Gain(c: Comments): Tags['replayGain'] {
  const read = (name: string) => {
    const v = c.get(name)?.[0]?.trim();
    if (v === undefined || !/^[+-]?\d+$/.test(v)) return undefined;
    return Math.round((Number(v) / 256 + 5) * 100) / 100;
  };
  const trackGain = read('R128_TRACK_GAIN');
  const albumGain = read('R128_ALBUM_GAIN');
  if (trackGain === undefined && albumGain === undefined) return undefined;
  return {
    ...(trackGain !== undefined ? { trackGain } : {}),
    ...(albumGain !== undefined ? { albumGain } : {}),
  };
}

/** The pictures in `METADATA_BLOCK_PICTURE` fields (base64 FLAC picture blocks), in order. */
export function vorbisPictures(c: Comments): Picture[] {
  const out: Picture[] = [];
  for (const value of c.get('METADATA_BLOCK_PICTURE') ?? []) {
    const bytes = decodeBase64(value);
    const picture = bytes ? parseFlacPicture(bytes) : null;
    if (picture) out.push(picture);
  }
  return out;
}
