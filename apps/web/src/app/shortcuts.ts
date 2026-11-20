/** What the Keyboard Shortcuts window lists (PRD §12): every command with a key, plus keys that aren't commands. */
import { COMMAND_GROUPS, type CommandCatalog, type CommandGroup } from '@playlark/ui';

export interface ShortcutLine {
  readonly title: string;
  /** Each way to press it; a way is one or more keys pressed in turn. */
  readonly keys: readonly (readonly string[])[];
}

export interface ShortcutGroup {
  readonly title: string;
  readonly lines: readonly ShortcutLine[];
}

const GROUP_TITLES: Record<CommandGroup, string> = {
  File: 'Library',
  Edit: 'Editing',
  Song: 'Songs',
  Controls: 'Playback',
  View: 'View',
  Help: 'Help',
};

/** Keys handled outside the catalog: in lists and dialogs, and Escape everywhere. */
function extras(mac: boolean): Partial<Record<CommandGroup, ShortcutLine[]>> {
  return {
    Song: [
      { title: 'Move through the list', keys: mac ? [['↓'], ['↑']] : [['Down'], ['Up']] },
      { title: 'First / last song', keys: mac ? [['↖'], ['↘']] : [['Home'], ['End']] },
    ],
    Help: [
      {
        title: 'Next / previous command in the command menu',
        keys: mac ? [['↓'], ['↑'], ['⇥'], ['⇧⇥']] : [['Down'], ['Up'], ['Tab'], ['Shift+Tab']],
      },
      { title: 'Close a window or menu', keys: [[mac ? '⎋' : 'Esc']] },
    ],
  };
}

export function shortcutGroups(catalog: CommandCatalog, mac: boolean): ShortcutGroup[] {
  const more = extras(mac);
  return COMMAND_GROUPS.map((group) => {
    const lines: ShortcutLine[] = catalog.all
      .filter((c) => c.group === group && c.sequences.length > 0)
      .map((c) => ({
        title: c.title.replace(/…$/, ''),
        keys: c.sequences.map((_, i) => catalog.keys({ ...c, sequences: [c.sequences[i]!] }, mac)),
      }));
    return { title: GROUP_TITLES[group], lines: [...lines, ...(more[group] ?? [])] };
  }).filter((g) => g.lines.length > 0);
}
