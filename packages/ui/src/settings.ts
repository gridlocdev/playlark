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
}

export const DEFAULT_SETTINGS: Settings = { volume: 1, replayGain: 'album', preamp: 0, crossfade: 0 };

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
  };
}

/** Where settings are kept. */
export interface SettingsStorage {
  load(): Settings;
  /** False when nothing could be kept: the settings then last while the window is open. */
  save(settings: Settings): boolean;
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
