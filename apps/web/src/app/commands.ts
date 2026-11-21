/**
 * Every command in the app (PRD §14). The keyboard, ⌘K, the menu bar, the now-playing bar's buttons, the
 * Keyboard Shortcuts window and docs/controls.md all come from this list.
 */
import { CommandCatalog, SEEK_STEP, VOLUME_STEP, isMac, type CommandSpec } from '@playlark/ui';
import type { AppController, DialogKind } from './controller.ts';
import { playlistCommands } from './playlistCommands.ts';
import { addToQueue, playNext, removeFromQueue } from './queueActions.ts';
import { all } from './selection.ts';
import type { View } from './views.ts';

/** The command that opens each dialog that has one: with that dialog open, its own shortcut closes it. */
const DIALOG_COMMAND: Readonly<Partial<Record<DialogKind, string>>> = {
  commands: 'help.commands',
  shortcuts: 'help.shortcuts',
  settings: 'file.settings',
};

/** The right-click menu on songs (§14). */
export const SONG_MENU: readonly string[] = [
  'song.play',
  '|',
  'song.playNext',
  'song.addToQueue',
  'song.addToPlaylist',
  'song.favourite',
  'song.info',
  'song.reveal',
  '|',
  'song.goToAlbum',
  'song.goToArtist',
];

/** The song menu inside a playlist adds Remove from Playlist (§14). */
export const PLAYLIST_SONG_MENU: readonly string[] = [...SONG_MENU, '|', 'playlist.removeEntries'];

/** View ▸ Songs, Albums, Artists, Folders, then the collections (§6.1), with what each shows. */
const VIEWS: readonly (readonly [string, string, string | null, View, string])[] = [
  ['view.songs', 'Songs', 'mod+1', { kind: 'songs' }, 'Show every song.'],
  ['view.albums', 'Albums', 'mod+2', { kind: 'albums' }, 'Show the albums.'],
  ['view.artists', 'Artists', 'mod+3', { kind: 'artists' }, 'Show the artists.'],
  ['view.folders', 'Folders', 'mod+4', { kind: 'folders', path: '' }, 'Show the folders.'],
  ['view.favourites', 'Favourites', null, { kind: 'favourites' }, 'Show the songs you favourited.'],
  ['view.recent', 'Recently Added', null, { kind: 'recent' }, 'Show the songs added in the last 90 days.'],
  ['view.mostPlayed', 'Most Played', null, { kind: 'mostPlayed' }, 'Show the 100 songs played most.'],
];

/** Where each playlist command goes in the catalog's order (menus follow it): before this command. */
const PLACE_BEFORE: Readonly<Record<string, string>> = {
  'playlist.new': 'file.rescan',
  'playlist.play': 'edit.selectAll',
  'playlist.shuffle': 'edit.selectAll',
  'playlist.rename': 'edit.selectAll',
  'playlist.delete': 'edit.selectAll',
  'edit.undo': 'edit.selectAll',
  'edit.redo': 'edit.selectAll',
  'song.addToPlaylist': 'song.favourite',
  'playlist.removeEntries': 'song.goToAlbum',
};

function placePlaylistCommands(specs: readonly CommandSpec[], extra: readonly CommandSpec[]): CommandSpec[] {
  const out = [...specs];
  for (const c of extra) {
    const at = out.findIndex((s) => s.id === PLACE_BEFORE[c.id]);
    out.splice(at < 0 ? out.length : at, 0, c);
  }
  return out;
}

/** What Favourite acts on: the selected songs, else the song playing (§10.2). */
function favouriteTargets(app: AppController): string[] {
  if (app.cursor.value !== null) return app.selectedSongs().map((s) => s.path);
  const playing = app.player.currentPath.value;
  return playing === undefined ? [] : [playing];
}

/** What the system calls its file manager. */
function revealTitle(): string {
  const platform = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (isMac) return 'Show in Finder';
  return /Windows/.test(platform) ? 'Show in File Explorer' : 'Show in File Manager';
}

export function buildCommands(app: AppController): CommandCatalog {
  const player = app.player;
  const hasSongs = () => app.songs.value.length > 0;
  const loaded = () => player.state.value !== 'stopped';
  const picked = () => app.cursor.value !== null;
  const upNext = () => {
    const q = player.queue.value;
    return q.index >= 0 && q.index < q.items.length - 1;
  };
  const toggleDialog = (kind: DialogKind) => () => {
    if (app.dialog.peek() === kind) app.close();
    else app.show(kind);
  };
  const specs: CommandSpec[] = [
    // The NAS serves one folder; only the desktop app and Chrome or Edge open one of the user's choice.
    ...(app.folders
      ? [
          {
            id: 'file.openFolder',
            title: 'Open Music Folder…',
            description: 'Play the music in another folder.',
            group: 'File',
            shortcuts: ['mod+o'],
            keywords: 'folder directory library switch location',
            run: () => app.openFolder(),
          } satisfies CommandSpec,
        ]
      : []),
    {
      id: 'file.rescan',
      title: 'Rescan Library',
      description: 'Read the music folder again for added, changed and removed songs.',
      group: 'File',
      shortcuts: ['mod+r'],
      keywords: 'refresh reload scan update',
      enabled: () => !!app.source.value && !app.scanning.value,
      run: () => app.rescan(),
    },
    ...(app.preferences
      ? [
          {
            id: 'file.settings',
            // On macOS the menu bar puts it in the app menu.
            title: 'Settings…',
            description: 'Change the appearance, ReplayGain, crossfade and rescanning at start.',
            group: 'File',
            shortcuts: ['mod+,'],
            keywords: 'preferences options theme dark light replaygain crossfade',
            global: true,
            run: toggleDialog('settings'),
          } satisfies CommandSpec,
        ]
      : []),
    {
      id: 'edit.selectAll',
      title: 'Select All',
      description: 'Select every song in the view, or all the text in a text field.',
      group: 'Edit',
      shortcuts: ['mod+a'],
      keywords: 'everything',
      global: true,
      run: () => {
        const field = typeof document === 'undefined' ? null : document.activeElement;
        if (field && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement))
          field.select();
        else app.selection.value = all(app.rowKeys.peek());
      },
    },
    {
      id: 'edit.find',
      title: 'Find',
      description: 'Search the library by title, artist, album or file name.',
      group: 'Edit',
      shortcuts: ['mod+f'],
      keywords: 'search filter look',
      global: true,
      enabled: hasSongs,
      run: () => app.focusSearch(),
    },
    {
      id: 'song.play',
      title: 'Play',
      description: 'Play the song list from the selected song.',
      group: 'Song',
      shortcuts: ['enter'],
      keysOnly: true,
      enabled: () => app.cursor.value !== null,
      run: () => app.playSelection(),
    },
    {
      id: 'song.playNext',
      title: 'Play Next',
      description: 'Play the selected songs after the song playing.',
      group: 'Song',
      keywords: 'queue after up next',
      context: true,
      enabled: picked,
      run: () => playNext(app, app.selectedSongs()),
    },
    {
      id: 'song.addToQueue',
      title: 'Add to Queue',
      description: 'Add the selected songs to the end of the queue.',
      group: 'Song',
      keywords: 'queue later end append',
      context: true,
      enabled: picked,
      run: () => addToQueue(app, app.selectedSongs()),
    },
    {
      id: 'song.favourite',
      title: 'Favourite',
      description:
        'Mark the selected songs as favourites, or unmark them. With none selected, the song playing.',
      group: 'Song',
      shortcuts: ['mod+alt+f'],
      keywords: 'heart love like star',
      context: true,
      enabled: () => favouriteTargets(app).length > 0,
      checked: () => {
        const paths = favouriteTargets(app);
        return paths.length > 0 && paths.every((p) => app.stats.get(p).favourite);
      },
      run: () => app.stats.toggleFavourite(favouriteTargets(app)),
    },
    ...(app.reveal
      ? [
          {
            id: 'song.reveal',
            title: revealTitle(),
            description: 'Show the selected song’s file in the system’s file manager.',
            group: 'Song',
            keywords: 'finder explorer file manager folder reveal locate open',
            context: true,
            enabled: () => app.selectedSongs().length === 1,
            run: async () => {
              const song = app.selectedSongs()[0];
              if (!song || !app.reveal) return;
              try {
                await app.reveal(song.path);
              } catch (e) {
                app.say(`Couldn’t show the file: ${e instanceof Error ? e.message : String(e)}`, {
                  tone: 'error',
                });
              }
            },
          } satisfies CommandSpec,
        ]
      : []),
    {
      id: 'song.info',
      title: 'Song Info…',
      description: 'Show and edit the tags and cover of the selected songs.',
      group: 'Song',
      shortcuts: ['mod+i'],
      keywords: 'tags edit metadata properties details cover title artist album',
      context: true,
      enabled: () => app.selectedSongs().some((s) => !s.error),
      run: () => {
        app.show('songInfo');
        void app.tags.open(app.selectedSongs());
      },
    },
    {
      id: 'song.goToAlbum',
      title: 'Go to Album',
      description: 'Open the selected song’s album.',
      group: 'Song',
      keywords: 'show open record',
      enabled: () => app.cursor.value !== null,
      run: () => {
        const song = app.focusedSong();
        if (song) app.goToAlbum(song);
      },
    },
    {
      id: 'song.goToArtist',
      title: 'Go to Artist',
      description: 'Open the selected song’s artist.',
      group: 'Song',
      keywords: 'show open band singer',
      enabled: () => app.cursor.value !== null,
      run: () => {
        const song = app.focusedSong();
        if (song) app.goToArtist(song);
      },
    },
    {
      id: 'song.goToCurrent',
      title: 'Go to Current Song',
      description: 'Select the song playing.',
      group: 'Song',
      shortcuts: ['mod+l'],
      keywords: 'playing now reveal locate',
      enabled: loaded,
      run: () => app.goToCurrent(),
    },
    {
      id: 'controls.playPause',
      title: 'Play/Pause',
      description: 'Pause the song playing, or play it again. With nothing playing, play the song list.',
      group: 'Controls',
      shortcuts: ['space'],
      keysOnly: true,
      keywords: 'pause resume start stop',
      enabled: () => loaded() || hasSongs(),
      run: () => app.playPause(),
    },
    {
      id: 'controls.next',
      title: 'Next',
      description: 'Play the next song in the queue.',
      group: 'Controls',
      shortcuts: ['mod+right'],
      keywords: 'skip forward track',
      enabled: loaded,
      run: () => player.next(),
    },
    {
      id: 'controls.previous',
      title: 'Previous',
      description: 'Go back to the start of the song, or to the song before if it only just began.',
      group: 'Controls',
      shortcuts: ['mod+left'],
      keywords: 'back track restart',
      enabled: loaded,
      run: () => player.previous(),
    },
    {
      id: 'controls.seekForward',
      title: 'Seek Forward',
      description: `Skip ${SEEK_STEP} seconds ahead in the song.`,
      group: 'Controls',
      shortcuts: ['mod+alt+right'],
      keywords: 'fast forward skip ahead',
      enabled: loaded,
      run: () => player.seekBy(SEEK_STEP),
    },
    {
      id: 'controls.seekBack',
      title: 'Seek Back',
      description: `Go back ${SEEK_STEP} seconds in the song.`,
      group: 'Controls',
      shortcuts: ['mod+alt+left'],
      keywords: 'rewind skip back',
      enabled: loaded,
      run: () => player.seekBy(-SEEK_STEP),
    },
    {
      id: 'controls.volumeUp',
      title: 'Volume Up',
      description: 'Make the music louder.',
      group: 'Controls',
      shortcuts: ['mod+up'],
      keywords: 'louder sound',
      enabled: () => player.volume.value < 1,
      run: () => player.setVolume(player.volume.peek() + VOLUME_STEP),
    },
    {
      id: 'controls.volumeDown',
      title: 'Volume Down',
      description: 'Make the music quieter.',
      group: 'Controls',
      shortcuts: ['mod+down'],
      keywords: 'quieter softer sound',
      enabled: () => player.volume.value > 0,
      run: () => player.setVolume(player.volume.peek() - VOLUME_STEP),
    },
    {
      id: 'controls.shuffle',
      title: 'Shuffle',
      description: 'Play the songs after this one in a random order, or put the order back.',
      group: 'Controls',
      shortcuts: ['mod+s'],
      keywords: 'random mix order',
      checked: () => player.shuffle.value,
      run: () => player.toggleShuffle(),
    },
    {
      id: 'controls.loop',
      title: 'Loop This Song',
      description: 'Play this song again each time it ends, until you turn it off or press Next.',
      group: 'Controls',
      shortcuts: ['mod+alt+r'],
      keywords: 'repeat again one',
      checked: () => player.repeat.value === 'one',
      run: () => player.toggleLoopSong(),
    },
    {
      id: 'controls.loopQueue',
      title: 'Loop Queue',
      description: 'Play the queue again from the start when it ends.',
      group: 'Controls',
      shortcuts: ['mod+alt+shift+r'],
      keywords: 'repeat again all list',
      checked: () => player.repeat.value === 'all',
      run: () => player.toggleLoopQueue(),
    },
    {
      id: 'queue.remove',
      title: 'Remove from Queue',
      description: 'Take the selected song out of Up Next.',
      group: 'Controls',
      shortcuts: ['backspace', 'delete'],
      keysOnly: true,
      keywords: 'delete up next',
      enabled: () => app.queueFocused.value && app.queueCursor.value !== null,
      run: () => removeFromQueue(app),
    },
    {
      id: 'queue.clear',
      title: 'Clear Up Next',
      description: 'Take every song after the one playing out of the queue.',
      group: 'Controls',
      keywords: 'empty queue remove all',
      enabled: upNext,
      run: () => player.clearUpNext(),
    },
    ...VIEWS.map(([id, title, key, view, description]): CommandSpec => ({
      id,
      title,
      description,
      group: 'View',
      shortcuts: key ? [key] : [],
      keywords: key ? 'library browse go' : 'collection browse go',
      checked: () => app.view.value.kind === view.kind,
      run: () => app.navigate(view),
    })),
    {
      id: 'view.back',
      title: 'Back',
      description: 'Go back to the view before.',
      group: 'View',
      shortcuts: ['mod+['],
      keywords: 'previous history',
      enabled: () => app.history.value.back.length > 0,
      run: () => app.goBack(),
    },
    {
      id: 'view.forward',
      title: 'Forward',
      description: 'Go forward again after going back.',
      group: 'View',
      shortcuts: ['mod+]'],
      keywords: 'next history',
      enabled: () => app.history.value.forward.length > 0,
      run: () => app.goForward(),
    },
    {
      id: 'view.sidebar',
      title: 'Show Sidebar',
      description: 'Show or hide the library list on the left.',
      group: 'View',
      shortcuts: ['mod+alt+s'],
      keywords: 'library panel navigation',
      checked: () => app.sidebarShown.value,
      run: () => {
        app.sidebarShown.value = !app.sidebarShown.peek();
      },
    },
    {
      id: 'view.queue',
      title: 'Show Queue',
      description: 'Show or hide the songs coming up.',
      group: 'View',
      shortcuts: ['mod+alt+u'],
      keywords: 'up next playing order list',
      checked: () => app.queueShown.value,
      run: () => {
        app.queueShown.value = !app.queueShown.peek();
      },
    },
    {
      id: 'help.shortcuts',
      title: 'Keyboard Shortcuts',
      description: 'Show every keyboard shortcut.',
      group: 'Help',
      shortcuts: ['mod+/'],
      keywords: 'keys help hotkeys',
      global: true,
      run: toggleDialog('shortcuts'),
    },
    {
      id: 'help.commands',
      title: 'Command Menu',
      description: 'Find and run any command by name.',
      group: 'Help',
      shortcuts: ['mod+k'],
      keywords: 'palette search run',
      global: true,
      run: toggleDialog('commands'),
    },
  ];
  const catalog = new CommandCatalog(placePlaylistCommands(specs, playlistCommands(app)));
  // With a dialog open, only the commands that open dialogs run (their shortcut closes their own dialog).
  catalog.gate = (c) => !app.blocked() || Object.values(DIALOG_COMMAND).includes(c.id);
  return catalog;
}
