/**
 * Every command in the app (PRD §14). The keyboard, ⌘K, the menu bar, the now-playing bar's buttons, the
 * Keyboard Shortcuts window and docs/controls.md all come from this list.
 */
import { CommandCatalog, SEEK_STEP, VOLUME_STEP, type CommandSpec } from '@playlark/ui';
import type { AppController, DialogKind } from './controller.ts';

/** The command that opens each dialog: with that dialog open, its own shortcut closes it. */
const DIALOG_COMMAND: Readonly<Record<DialogKind, string>> = {
  commands: 'help.commands',
  shortcuts: 'help.shortcuts',
};

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
      id: 'song.play',
      title: 'Play',
      description: 'Play the song list from the selected song.',
      group: 'Song',
      shortcuts: ['enter'],
      keysOnly: true,
      enabled: () => app.cursor.value !== null,
      run: () => {
        const path = app.cursor.peek();
        if (path !== null) return app.playPath(path);
      },
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
