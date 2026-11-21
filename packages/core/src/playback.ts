/** The sums behind playback (PRD §8.3, §8.6, §8.7): gapless trimming, ReplayGain and when to crossfade. */
import type { Song } from './library/song.ts';
import type { ReplayGain } from './tags/types.ts';

/** The part of a decoded song to play, in seconds. */
export interface Trim {
  readonly start: number;
  readonly duration: number;
}

/**
 * Which part of the decoder's output is the song (§4.3, §8.3). When the output is longer than the song's real
 * length, the encoder delay is cut from the start and the rest from the end; when it already matches (the
 * decoder trimmed for us), nothing is cut. `frames` and `rate` are the decoded buffer's.
 */
export function trimFor(
  frames: number,
  rate: number,
  song: Pick<Song, 'duration' | 'sampleRate' | 'encoderDelay'>,
): Trim {
  const whole: Trim = { start: 0, duration: frames / rate };
  if (!(song.duration > 0) || !(rate > 0)) return whole;
  const real = Math.round(song.duration * rate);
  // One frame either way is rounding, not padding.
  const extra = frames - real;
  if (extra <= 1) return whole;
  const scale = song.sampleRate > 0 ? rate / song.sampleRate : 1;
  const delay = Math.round((song.encoderDelay ?? 0) * scale);
  return { start: Math.min(delay, extra) / rate, duration: real / rate };
}

export type ReplayGainMode = 'off' | 'track' | 'album';

/** The pre-amp's range in dB (§8.6). */
export const PREAMP_LIMIT = 6;

/**
 * The linear gain for a song (§8.6): Album uses the album gain, else the track gain; Track the reverse. The
 * pre-amp is added, and the result is held down so the peak never goes past full scale. No tags: 1.
 */
export function replayGainFactor(rg: ReplayGain | undefined, mode: ReplayGainMode, preampDb = 0): number {
  if (mode === 'off' || !rg) return 1;
  const album = mode === 'album';
  const gain = album ? (rg.albumGain ?? rg.trackGain) : (rg.trackGain ?? rg.albumGain);
  if (gain === undefined) return 1;
  const usedAlbum = album ? rg.albumGain !== undefined : rg.trackGain === undefined;
  const peak = usedAlbum ? (rg.albumPeak ?? rg.trackPeak) : (rg.trackPeak ?? rg.albumPeak);
  const pre = Math.max(-PREAMP_LIMIT, Math.min(PREAMP_LIMIT, preampDb));
  const factor = 10 ** ((gain + pre) / 20);
  return peak !== undefined && peak > 0 ? Math.min(factor, 1 / peak) : factor;
}

/** The crossfade setting's range in seconds; 0 is off (§8.7). */
export const CROSSFADE_MAX = 12;

/**
 * How long to fade from `from` into `to` when one ends by itself (§8.7): never between one album's track n and
 * n + 1, never into the same song again (Loop This Song), never longer than either song.
 */
export function crossfadeFor(from: Song, to: Song, seconds: number): number {
  if (!(seconds > 0)) return 0;
  if (from.path === to.path) return 0;
  const sameAlbum =
    from.album === to.album &&
    from.albumArtist === to.albumArtist &&
    (from.disc ?? 1) === (to.disc ?? 1) &&
    from.track !== undefined &&
    to.track === from.track + 1;
  if (sameAlbum) return 0;
  return Math.max(0, Math.min(seconds, CROSSFADE_MAX, from.duration / 2, to.duration / 2));
}

/** Equal-power fade curves (§8.7): `steps` gains for the song fading out and the one fading in. */
export function fadeCurves(steps: number): { readonly out: Float32Array; readonly in: Float32Array } {
  const out = new Float32Array(steps);
  const into = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 1 : i / (steps - 1);
    out[i] = Math.cos((t * Math.PI) / 2);
    into[i] = Math.sin((t * Math.PI) / 2);
  }
  return { out, in: into };
}
