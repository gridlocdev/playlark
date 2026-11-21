/**
 * The channels between the main process and the preload. The sandboxed preload can't import this file,
 * so it repeats the names: keep the two in step.
 */
export const Channels = {
  setMenu: 'playlark:set-menu',
  command: 'playlark:command',
  fullScreen: 'playlark:full-screen',
  currentFolder: 'playlark:current-folder',
  chooseFolder: 'playlark:choose-folder',
  useMusicFolder: 'playlark:use-music-folder',
  loadSettings: 'playlark:load-settings',
  saveSettings: 'playlark:save-settings',
  setAppearance: 'playlark:set-appearance',
  listFiles: 'playlark:list-files',
  loadIndex: 'playlark:load-index',
  saveIndex: 'playlark:save-index',
  saveCover: 'playlark:save-cover',
  pruneCovers: 'playlark:prune-covers',
  loadQueue: 'playlark:load-queue',
  saveQueue: 'playlark:save-queue',
  loadStats: 'playlark:load-stats',
  saveStats: 'playlark:save-stats',
  writePlaylist: 'playlark:write-playlist',
  renamePlaylist: 'playlark:rename-playlist',
  trashPlaylist: 'playlark:trash-playlist',
  writeTags: 'playlark:write-tags',
} as const;

/** One item of the menu bar the page sends, as `NativeMenuItem` in @playlark/ui. */
export interface NativeMenuItem {
  readonly type?: 'separator' | 'checkbox';
  readonly role?: string;
  readonly label?: string;
  readonly command?: string;
  readonly accelerator?: string;
  readonly enabled?: boolean;
  readonly checked?: boolean;
  readonly submenu?: readonly NativeMenuItem[];
}

/** The music folder as the page sees it (`NativeFolder` in the web app). */
export interface FolderInfo {
  readonly path: string;
  readonly name: string;
  readonly missing: boolean;
}
