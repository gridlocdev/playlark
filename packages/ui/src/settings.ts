import { CROSSFADE_MAX, PREAMP_LIMIT, type ReplayGainMode } from '@playlark/core';

/**
 * Per-device settings (PRD §13): kept in this browser profile or this desktop app, never in the music folder. A
 * missing or wrong field takes its default, so one bad value never throws the rest away.
 */
export interface Settings {
  /** 0 to 1 (PRD §8.1). */
  readonly volume: number;
  /** PRD §8.7. */
  readonly replayGain: ReplayGainMode;
  /** dB, −PREAMP_LIMIT to +PREAMP_LIMIT (PRD §8.7). */
  readonly preamp: number;
  /** Seconds, 0 (off) to CROSSFADE_MAX (PRD §8.6). */
  readonly crossfade: number;
  /** Light, dark, or as the system is (PRD §19). */
  readonly appearance: Appearance;
  /** Read the folder again at start, or show the index from last time until Rescan (PRD §19). */
  readonly rescanOnStart: boolean;
}

export type Appearance = 'system' | 'light' | 'dark';
export const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];

export const DEFAULT_SETTINGS: Settings = {
  volume: 1,
  replayGain: 'album',
  preamp: 0,
  crossfade: 0,
  appearance: 'system',
  rescanOnStart: true,
};

const REPLAY_GAIN_MODES: readonly ReplayGainMode[] = ['off', 'track', 'album'];

const within = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && v >= min && v <= max ? v : fallback;

export function parseSettings(raw: unknown): Settings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    volume: within(o.volume, 0, 1, d.volume),
    replayGain: REPLAY_GAIN_MODES.includes(o.replayGain as ReplayGainMode)
      ? (o.replayGain as ReplayGainMode)
      : d.replayGain,
    preamp: within(o.preamp, -PREAMP_LIMIT, PREAMP_LIMIT, d.preamp),
    crossfade: within(o.crossfade, 0, CROSSFADE_MAX, d.crossfade),
    appearance: APPEARANCES.includes(o.appearance as Appearance)
      ? (o.appearance as Appearance)
      : d.appearance,
    rescanOnStart: typeof o.rescanOnStart === 'boolean' ? o.rescanOnStart : d.rescanOnStart,
  };
}

/** Where settings are kept. */
export interface SettingsStorage {
  load(): Settings;
  /** False when nothing could be kept: the settings then last while the window is open. */
  save(settings: Settings): boolean;
}

/**
 * Settings kept in a file the page reads once at start (the desktop app's `settings.json`, PRD §19): `text` is
 * what was read, and each save writes the whole file. A failed write is reported to `failed`.
 */
export function fileSettings(
  text: string | null,
  write: (text: string) => Promise<void>,
  failed: (e: unknown) => void,
): SettingsStorage {
  let current = DEFAULT_SETTINGS;
  try {
    current = parseSettings(text === null ? null : JSON.parse(text));
  } catch (e) {
    // A damaged file: the defaults, and the next save writes a good one.
    if (!(e instanceof SyntaxError)) throw e;
  }
  return {
    load: () => current,
    save: (settings) => {
      current = settings;
      write(`${JSON.stringify(settings, null, 2)}\n`).catch(failed);
      return true;
    },
  };
}

/** The browser profile's storage (the desktop app's page has its own). Blocked storage gives the defaults. */
export function browserSettings(key = 'playlark.settings'): SettingsStorage {
  return {
    load: () => {
      try {
        const text = localStorage.getItem(key);
        return parseSettings(text === null ? null : JSON.parse(text));
      } catch {
        return DEFAULT_SETTINGS;
      }
    },
    save: (settings) => {
      try {
        localStorage.setItem(key, JSON.stringify(settings));
        return true;
      } catch {
        return false;
      }
    },
  };
}
