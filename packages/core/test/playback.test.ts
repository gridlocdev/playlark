import { describe, expect, it } from 'vitest';
import { type Song, crossfadeFor, fadeCurves, replayGainFactor, trimFor } from '../src/index.ts';

const song = (extra: Partial<Song> = {}): Song => ({
  path: 'a.mp3',
  size: 1,
  mtime: 1,
  format: 'mp3',
  codec: 'mp3',
  title: 'A',
  artist: 'X',
  album: 'Y',
  albumArtist: 'X',
  compilation: false,
  duration: 2,
  sampleRate: 44100,
  channels: 2,
  ...extra,
});

describe('gapless trimming', () => {
  it('cuts nothing when the decoder already trimmed', () => {
    expect(trimFor(88200, 44100, song())).toEqual({ start: 0, duration: 2 });
    expect(trimFor(88201, 44100, song())).toEqual({ start: 0, duration: 88201 / 44100 });
  });

  it('cuts the encoder delay from the start and the rest from the end', () => {
    const t = trimFor(88200 + 1105 + 700, 44100, song({ encoderDelay: 1105, encoderPadding: 700 }));
    expect(t).toEqual({ start: 1105 / 44100, duration: 2 });
  });

  it('scales the delay when the decoder resampled, and never cuts more than the extra', () => {
    expect(trimFor(96000 + 2000, 48000, song({ encoderDelay: 1105 })).start).toBeCloseTo(1203 / 48000, 6);
    expect(trimFor(88200 + 100, 44100, song({ encoderDelay: 1105 })).start).toBeCloseTo(100 / 44100, 9);
  });

  it('plays the whole buffer when the file doesn’t say how long it is', () => {
    expect(trimFor(1000, 44100, song({ duration: 0 }))).toEqual({ start: 0, duration: 1000 / 44100 });
  });
});

describe('ReplayGain', () => {
  const rg = { trackGain: -6, trackPeak: 0.5, albumGain: -3, albumPeak: 0.8 };
  const db = (f: number) => 20 * Math.log10(f);

  it('uses the album gain in Album mode and the track gain in Track mode, each falling back to the other', () => {
    expect(db(replayGainFactor(rg, 'album'))).toBeCloseTo(-3);
    expect(db(replayGainFactor(rg, 'track'))).toBeCloseTo(-6);
    expect(db(replayGainFactor({ trackGain: -2 }, 'album'))).toBeCloseTo(-2);
    expect(db(replayGainFactor({ albumGain: -4 }, 'track'))).toBeCloseTo(-4);
    expect(replayGainFactor(rg, 'off')).toBe(1);
    expect(replayGainFactor(undefined, 'album')).toBe(1);
  });

  it('adds the pre-amp, but never past the peak', () => {
    expect(db(replayGainFactor(rg, 'track', 3))).toBeCloseTo(-3);
    // +6 dB on a 0.8 peak would clip: held to 1 / 0.8.
    expect(replayGainFactor({ albumGain: 6, albumPeak: 0.8 }, 'album')).toBeCloseTo(1.25);
    expect(db(replayGainFactor(rg, 'track', 20))).toBeCloseTo(0);
  });
});

describe('crossfade', () => {
  it('fades between unrelated songs, for no longer than the setting or half a song', () => {
    const a = song({ path: 'a', duration: 200 });
    const b = song({ path: 'b', album: 'Other', duration: 200 });
    expect(crossfadeFor(a, b, 5)).toBe(5);
    expect(crossfadeFor(a, b, 0)).toBe(0);
    expect(crossfadeFor(a, song({ path: 'c', duration: 4 }), 5)).toBe(2);
  });

  it('never between an album’s next tracks, nor into the same song again', () => {
    const one = song({ path: '1', track: 1, duration: 200 });
    const two = song({ path: '2', track: 2, duration: 200 });
    expect(crossfadeFor(one, two, 5)).toBe(0);
    expect(crossfadeFor(two, one, 5)).toBe(5);
    expect(crossfadeFor(one, one, 5)).toBe(0);
  });

  it('keeps the power even: out² + in² = 1', () => {
    const { out, in: into } = fadeCurves(9);
    for (let i = 0; i < 9; i++) expect(out[i]! ** 2 + into[i]! ** 2).toBeCloseTo(1);
    expect([out[0], into[0], out[8]]).toEqual([1, 0, expect.closeTo(0)]);
  });
});
