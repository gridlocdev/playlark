/** The playlist commands (PRD §9.2, §14), and Undo and Redo, which every playlist edit goes through. */
import type { CommandSpec } from '@playlark/ui';
import type { AppController } from './controller.ts';

/** The right-click menu on a playlist in the sidebar (§14). */
export const PLAYLIST_MENU: readonly string[] = [
  'playlist.play',
  'playlist.shuffle',
  '|',
  'playlist.rename',
  'playlist.delete',
];

const inTextField = () =>
  typeof document !== 'undefined' &&
  !!document.activeElement?.closest('input:not([type=range]), textarea, [contenteditable="true"]');

/** The song table has the keyboard, so ⌘N starts the playlist with the selected songs. */
const inSongList = () =>
  typeof document !== 'undefined' &&
  !!document.activeElement?.closest('.pl-songs [role="grid"], [role="grid"]');

/** The playlist the commands act on: the one right-clicked in the sidebar, else the one shown. */
export function targetPlaylist(app: AppController): string | null {
  const view = app.view.value;
  return app.playlists.target.value ?? (view.kind === 'playlist' ? view.path : null);
}

async function playPlaylist(app: AppController, path: string, shuffle: boolean): Promise<void> {
  await app.playlists.load(path);
  const songs = app.playlists.songsOf(path);
  await (shuffle ? app.shuffleSongs(songs) : app.playSongs(songs));
}

export function playlistCommands(app: AppController): CommandSpec[] {
  const playlists = app.playlists;
  const editable = () => !!app.source.value && playlists.editable.value;
  const inPlaylist = () => app.view.value.kind === 'playlist';
  const target = () => targetPlaylist(app);
  return [
    {
      id: 'playlist.new',
      title: 'New Playlist',
      description: 'Make a playlist with the selected songs, and name it.',
      group: 'File',
      shortcuts: ['mod+n'],
      keywords: 'create add list mix',
      enabled: editable,
      run: async () => {
        const songs = inSongList() ? app.selectedSongs().map((s) => s.path) : [];
        const path = await playlists.create(songs);
        if (path) {
          app.sidebarShown.value = true;
          app.navigate({ kind: 'playlist', path });
        }
      },
    },
    {
      id: 'edit.undo',
      title: 'Undo',
      description: 'Take back the last playlist change, or the last typing in a text field.',
      group: 'Edit',
      shortcuts: ['mod+z'],
      keywords: 'back revert',
      global: true,
      enabled: () => app.undo.canUndo.value,
      run: () => (inTextField() ? void document.execCommand('undo') : app.undoStep()),
    },
    {
      id: 'edit.redo',
      title: 'Redo',
      description: 'Make the change Undo took back again.',
      group: 'Edit',
      shortcuts: ['shift+mod+z'],
      keywords: 'again forward',
      global: true,
      enabled: () => app.undo.canRedo.value,
      run: () => (inTextField() ? void document.execCommand('redo') : app.undoStep(true)),
    },
    {
      id: 'song.addToPlaylist',
      title: 'Add to Playlist…',
      description: 'Add the selected songs to the end of a playlist.',
      group: 'Song',
      keywords: 'playlist list mix append',
      context: true,
      enabled: () => editable() && app.cursor.value !== null,
      run: () => app.show('addToPlaylist'),
    },
    {
      id: 'playlist.removeEntries',
      title: 'Remove from Playlist',
      description: 'Take the selected songs out of this playlist. Their files stay.',
      group: 'Song',
      shortcuts: ['backspace', 'delete'],
      keywords: 'delete take out',
      context: true,
      enabled: () => inPlaylist() && editable() && !app.queueFocused.value && app.cursor.value !== null,
      run: () => {
        const view = app.view.peek();
        if (view.kind === 'playlist') return playlists.remove(view.path, app.selectedIndexes());
      },
    },
    {
      id: 'playlist.play',
      title: 'Play Playlist',
      description: 'Play the playlist from the top.',
      group: 'File',
      keywords: 'start listen',
      enabled: () => target() !== null,
      run: () => {
        const path = target();
        if (path) return playPlaylist(app, path, false);
      },
    },
    {
      id: 'playlist.shuffle',
      title: 'Shuffle Playlist',
      description: 'Play the playlist in a random order.',
      group: 'File',
      keywords: 'random mix',
      enabled: () => target() !== null,
      run: () => {
        const path = target();
        if (path) return playPlaylist(app, path, true);
      },
    },
    {
      id: 'playlist.rename',
      title: 'Rename Playlist',
      description: 'Give the playlist a new name; its file is renamed.',
      group: 'File',
      keywords: 'name title change',
      enabled: () => editable() && target() !== null,
      run: () => {
        app.sidebarShown.value = true;
        playlists.renaming.value = target();
      },
    },
    {
      id: 'playlist.delete',
      title: 'Delete Playlist',
      description: 'Move the playlist’s file to the trash. Its songs stay.',
      group: 'File',
      keywords: 'remove trash',
      danger: true,
      enabled: () => editable() && target() !== null,
      run: () => {
        const path = target();
        if (path) return playlists.delete(path);
      },
    },
  ];
}
