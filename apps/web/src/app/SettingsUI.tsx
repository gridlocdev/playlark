/** The Settings window (PRD §19) and the desktop app's first-start folder question (§16.2). */
import { CROSSFADE_MAX, PREAMP_LIMIT, type ReplayGainMode } from '@playlark/core';
import { APPEARANCES, Dialog, type Appearance } from '@playlark/ui';
import type { AppController } from './controller.ts';
import type { Preferences } from './preferences.ts';

const APPEARANCE_NAMES: Readonly<Record<Appearance, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};
const REPLAY_GAIN: readonly (readonly [ReplayGainMode, string])[] = [
  ['off', 'Off'],
  ['track', 'Track'],
  ['album', 'Album'],
];
const CROSSFADES = Array.from({ length: CROSSFADE_MAX + 1 }, (_, i) => i);
const PREAMPS = Array.from({ length: PREAMP_LIMIT * 2 + 1 }, (_, i) => i - PREAMP_LIMIT);

/** Each change takes effect and is kept at once; ReplayGain and crossfade apply from the next song. */
export function SettingsDialog({ app, prefs }: { readonly app: AppController; readonly prefs: Preferences }) {
  const s = prefs.value.value;
  const set = (change: Parameters<Preferences['set']>[0]) => {
    if (!prefs.set(change))
      app.say('Settings can’t be kept here; they last until the window closes.', { tone: 'error' });
  };
  return (
    <Dialog
      title="Settings"
      onClose={() => app.close()}
      actions={
        <button type="button" class="pl-button pl-button-primary" onClick={() => app.close()}>
          Close
        </button>
      }
    >
      <label class="pl-field">
        <span>Appearance</span>
        <select
          value={s.appearance}
          onChange={(e) => set({ appearance: e.currentTarget.value as Appearance })}
        >
          {APPEARANCES.map((a) => (
            <option key={a} value={a}>
              {APPEARANCE_NAMES[a]}
            </option>
          ))}
        </select>
      </label>
      <label class="pl-field">
        <span>ReplayGain</span>
        <select
          value={s.replayGain}
          onChange={(e) => set({ replayGain: e.currentTarget.value as ReplayGainMode })}
        >
          {REPLAY_GAIN.map(([mode, name]) => (
            <option key={mode} value={mode}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label class="pl-field">
        <span>Pre-amp</span>
        <select
          value={String(s.preamp)}
          disabled={s.replayGain === 'off'}
          onChange={(e) => set({ preamp: Number(e.currentTarget.value) })}
        >
          {PREAMPS.map((db) => (
            <option key={db} value={String(db)}>
              {db > 0 ? `+${db}` : db} dB
            </option>
          ))}
        </select>
      </label>
      <label class="pl-field">
        <span>Crossfade</span>
        <select
          value={String(s.crossfade)}
          onChange={(e) => set({ crossfade: Number(e.currentTarget.value) })}
        >
          {CROSSFADES.map((sec) => (
            <option key={sec} value={String(sec)}>
              {sec === 0 ? 'Off' : `${sec} s`}
            </option>
          ))}
        </select>
      </label>
      <label class="pl-field">
        <span>Rescan on start</span>
        <input
          type="checkbox"
          checked={s.rescanOnStart}
          onChange={(e) => set({ rescanOnStart: e.currentTarget.checked })}
        />
      </label>
    </Dialog>
  );
}

/**
 * Which folder to play (§16.2): asked at first start, and when the folder chosen last time is gone. In the page,
 * not a system dialog; Choose Folder… then shows the system's folder picker.
 */
export function ChooseFolderDialog({ app }: { readonly app: AppController }) {
  const missing = app.missingFolder.value;
  return (
    <Dialog
      title={missing ? 'Music Folder Not Found' : 'Choose Your Music'}
      onClose={() => app.close()}
      actions={
        <>
          <button type="button" class="pl-button" onClick={() => void app.openFolder()}>
            Choose Folder…
          </button>
          <button type="button" class="pl-button pl-button-primary" onClick={() => void app.openFolder(true)}>
            Use Music Folder
          </button>
        </>
      }
    >
      {missing ? (
        <p>
          The music folder <strong>{missing}</strong> isn’t there. It may be on a drive that isn’t plugged in.
          Play the songs in your Music folder, or choose another folder.
        </p>
      ) : (
        <p>Playlark plays the songs in a folder. Use your Music folder, or choose another one.</p>
      )}
    </Dialog>
  );
}
