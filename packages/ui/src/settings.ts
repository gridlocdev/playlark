/**
 * Per-device settings (PRD §13): kept in this browser profile or this desktop app, never in the music folder. A
 * missing or wrong field takes its default, so one bad value never throws the rest away.
 */
export interface Settings {
  /** 0 to 1 (PRD §8.1). */
  readonly volume: number;
}

export const DEFAULT_SETTINGS: Settings = { volume: 1 };

export function parseSettings(raw: unknown): Settings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const volume =
    typeof o.volume === 'number' && o.volume >= 0 && o.volume <= 1 ? o.volume : DEFAULT_SETTINGS.volume;
  return { volume };
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
