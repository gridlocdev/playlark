/** What the desktop app's preload script puts on `window.playlarkNative` (PRD §16.1). */
import type { LibraryFile } from '@playlark/core';
import type { IndexBridge, NativeMenuItem, PlaylistWriter } from '@playlark/ui';

/** The music folder the desktop app has open. `missing`: the one chosen last time is gone. */
export interface NativeFolder {
  readonly path: string;
  readonly name: string;
  readonly missing: boolean;
}

export interface PlaylarkNative {
  readonly version: string;
  /** 'unified': the window has no title bar and the page draws the toolbar row in its place (macOS). */
  readonly chrome: 'unified' | 'native';
  /** Replaces the menu bar. */
  setMenu(items: readonly NativeMenuItem[]): void;
  /** A menu bar item was chosen. */
  onCommand(fn: (id: string) => void): void;
  /** The window entered or left full screen. */
  onFullScreen(fn: (full: boolean) => void): void;
  readonly folder: {
    /** The folder open now, the missing one, or null when none was chosen. */
    current(): Promise<NativeFolder | null>;
    /** Asks for a folder; null when the user cancelled. */
    choose(): Promise<NativeFolder | null>;
  };
  /** Every music file in the open folder. Their bytes come from `app://playlark/media/<path>`. */
  listFiles(): Promise<readonly LibraryFile[]>;
  /** The library index and its covers, kept in the app's data folder (PRD §3.2). */
  readonly index: IndexBridge;
  /** Writes, renames and trashes playlists in the open folder (PRD §9). */
  readonly playlists: PlaylistWriter;
}

export function nativeBridge(): PlaylarkNative | null {
  return (globalThis as { playlarkNative?: PlaylarkNative }).playlarkNative ?? null;
}
