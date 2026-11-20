/**
 * Every command in the app (PRD §14). The keyboard, ⌘K, the menu bar, the now-playing bar's buttons, the
 * Keyboard Shortcuts window and docs/controls.md all come from this list.
 */
import { CommandCatalog, SEEK_STEP, VOLUME_STEP, type CommandSpec } from '@playlark/ui';
import type { AppController, DialogKind } from './controller.ts';
import { all } from './selection.ts';
import type { View } from './views.ts';

/** The command that opens each dialog that has one: with that dialog open, its own shortcut closes it. */
const DIALOG_COMMAND: Readonly<Partial<Record<DialogKind, string>>> = {
  commands: 'help.commands',
  shortcuts: 'help.shortcuts',
};

/** View ▸ Songs, Albums, Artists, Folders (§6.1). */
const VIEWS: readonly (readonly [string, string, string, View])[] = [
  ['view.songs', 'Songs', 'mod+1', { kind: 'songs' }],
  ['view.albums', 'Albums', 'mod+2', { kind: 'albums' }],
  ['view.artists', 'Artists', 'mod+3', { kind: 'artists' }],
  ['view.folders', 'Folders', 'mod+4', { kind: 'folders', path: '' }],
];

export function buildCommands(app: AppController): CommandCatalog {
  const player = app.player;
  const hasSongs = () => app.songs.value.length > 0;
  const loaded = () => player.state.value !== 'stopped';
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
        else app.selection.value = all(app.rowPaths.peek());
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
    ...VIEWS.map(([id, title, key, view]): CommandSpec => ({
      id,
      title,
      description: `Show ${title.toLowerCase() === 'songs' ? 'every song' : `the ${title.toLowerCase()}`}.`,
      group: 'View',
      shortcuts: [key],
      keywords: 'library browse go',
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
  const catalog = new CommandCatalog(specs);
  // With a dialog open, only the commands that open dialogs run (their shortcut closes their own dialog).
  catalog.gate = (c) => !app.blocked() || Object.values(DIALOG_COMMAND).includes(c.id);
  return catalog;
}
