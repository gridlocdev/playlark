/** What the window controller is built from (PRD §6.1). */
import type { AudioEngine, IndexStore, LibrarySource, PlaybackSettings } from '@playlark/ui';
import type { Preferences } from './preferences.ts';

export type DialogKind =
  'commands' | 'shortcuts' | 'unreadable' | 'addToPlaylist' | 'songInfo' | 'settings' | 'chooseFolder';

/** Where the folder comes from: the user picks one (desktop, Chrome), or it is fixed (NAS). */
export interface FolderChooser {
  /** Asks for a folder; null when the user cancelled. */
  choose(): Promise<LibrarySource | null>;
  /** The usual music folder (the desktop app's ~/Music, §16.2); null when it isn't there. */
  useDefault?(): Promise<LibrarySource | null>;
}

export interface ControllerOptions {
  readonly engine: AudioEngine;
  readonly version: string;
  /** Absent when the folder can't be changed here (the NAS) or can't be opened at all (§17). */
  readonly folders?: FolderChooser;
  /** Why no folder can be opened here, shown in place of the song list (§17). */
  readonly cannotOpen?: string;
  readonly volume?: number;
  readonly onVolume?: (volume: number) => void;
  /** ReplayGain and crossfade (§8.6, §8.7). */
  readonly playback?: () => PlaybackSettings;
  /** The Settings window's values (§19). Absent: no Settings window. */
  readonly preferences?: Preferences;
  /** A seed for each shuffle; tests pin it. */
  readonly seed?: () => number;
  /** Where the index and its covers are kept between runs (§3.2). Absent: nothing is kept. */
  readonly index?: IndexStore;
  /** A URL an `<img>` can show for bytes read from the folder (a folder's cover image). */
  readonly imageUrl?: (bytes: ArrayBuffer, mime: string) => string;
  /** Today, for the index's scan date and the stats' times. */
  readonly now?: () => Date;
  /** A clock in ms that only goes forward, for how long a song was heard (§10.2); tests pin it. */
  readonly clock?: () => number;
}
