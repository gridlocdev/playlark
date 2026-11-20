import type { MenuItemConstructorOptions } from 'electron';
import type { NativeMenuItem } from './bridge.ts';

/** The only roles the page may ask for: the Edit menu's text commands. */
const PAGE_ROLES: ReadonlySet<string> = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);

/** Keeps the items the main process can build safely; the page's message is not trusted to be well formed. */
function wellFormed(item: unknown): item is NativeMenuItem {
  if (!item || typeof item !== 'object') return false;
  const i = item as Record<string, unknown>;
  const optionalString = (v: unknown) => v === undefined || typeof v === 'string';
  return (
    (i.type === undefined || i.type === 'separator' || i.type === 'checkbox') &&
    (i.role === undefined || (typeof i.role === 'string' && PAGE_ROLES.has(i.role))) &&
    optionalString(i.label) &&
    optionalString(i.command) &&
    optionalString(i.accelerator) &&
    (i.submenu === undefined || Array.isArray(i.submenu))
  );
}

/**
 * The page's menus as an Electron template. Accelerators only show the key and run the command through
 * `send`; plain keys are in the label after a tab, so the page keeps handling them. Items that aren't well
 * formed, or ask for a role other than the Edit menu's, are left out. Pure, so it can be tested without Electron.
 */
export function toTemplate(
  items: readonly unknown[],
  send: (command: string) => void,
): MenuItemConstructorOptions[] {
  return items.filter(wellFormed).map((item): MenuItemConstructorOptions => {
    if (item.type === 'separator') return { type: 'separator' };
    if (item.role)
      return {
        role: item.role as MenuItemConstructorOptions['role'],
        ...(item.label ? { label: item.label } : {}),
      };
    const opts: MenuItemConstructorOptions = {
      label: item.label ?? '',
      enabled: item.enabled !== false,
      ...(item.accelerator ? { accelerator: item.accelerator } : {}),
      ...(item.type === 'checkbox' ? { type: 'checkbox', checked: item.checked === true } : {}),
    };
    if (item.submenu) opts.submenu = toTemplate(item.submenu, send);
    else if (item.command) {
      const id = item.command;
      opts.id = id;
      opts.click = () => send(id);
    }
    return opts;
  });
}

/** The page's Settings item. On macOS it moves from File to the app menu, where Mac apps keep it. */
const SETTINGS_LABEL = 'Settings…';

/** Takes the Settings item out of `items`, with a separator it leaves dangling. */
function withoutSettings(items: readonly MenuItemConstructorOptions[]): {
  items: MenuItemConstructorOptions[];
  settings: MenuItemConstructorOptions | null;
} {
  const at = items.findIndex((i) => i.label === SETTINGS_LABEL);
  if (at < 0) return { items: [...items], settings: null };
  const rest = items.filter((_, i) => i !== at);
  while (rest[0]?.type === 'separator') rest.shift();
  while (rest.at(-1)?.type === 'separator') rest.pop();
  return { items: rest, settings: items[at]! };
}

/** The macOS app menu, with the page's Settings item in its usual place. */
function appMenu(settings: MenuItemConstructorOptions | null): MenuItemConstructorOptions {
  if (!settings) return { role: 'appMenu' };
  return {
    role: 'appMenu',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      settings,
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
}

/**
 * The platform's standard menus around the page's: the app menu on macOS (with Settings and Quit), Quit at
 * the end of File elsewhere, a View block with zoom and full screen, and a Window menu before Help.
 */
export function withStandardMenus(
  template: readonly MenuItemConstructorOptions[],
  platform: NodeJS.Platform,
  devTools = false,
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  let settings: MenuItemConstructorOptions | null = null;
  const menus = template.map((menu): MenuItemConstructorOptions => {
    if (!Array.isArray(menu.submenu)) return menu;
    if (mac && menu.label === 'File') {
      const moved = withoutSettings(menu.submenu);
      settings = moved.settings;
      menu = { ...menu, submenu: moved.items };
    }
    if (!Array.isArray(menu.submenu)) return menu;
    if (!mac && menu.label === 'File')
      return { ...menu, submenu: [...menu.submenu, { type: 'separator' }, { role: 'quit' }] };
    if (menu.label === 'View')
      return {
        ...menu,
        submenu: [
          ...menu.submenu,
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          ...(devTools ? [{ role: 'toggleDevTools' } as const] : []),
        ],
      };
    return menu;
  });
  const help = menus.findIndex((m) => m.label === 'Help');
  menus.splice(help < 0 ? menus.length : help, 0, windowMenu(mac));
  if (mac) menus.unshift(appMenu(settings));
  // A menu left empty (File on macOS once Settings moves out) isn't shown.
  return menus.filter((m) => !Array.isArray(m.submenu) || m.submenu.length > 0);
}

/** On macOS the `windowMenu` role; elsewhere Minimize and Zoom (the role would add a second Ctrl+W). */
function windowMenu(mac: boolean): MenuItemConstructorOptions {
  if (mac) return { role: 'windowMenu' };
  return {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      {
        label: 'Zoom',
        click: (_item, win) => {
          if (!win) return;
          if (win.isMaximized()) win.unmaximize();
          else win.maximize();
        },
      },
    ],
  };
}

/** The parts of Electron's `context-menu` params the text-field menu reads. */
export interface EditMenuParams {
  readonly isEditable: boolean;
  readonly selectionText: string;
  readonly misspelledWord: string;
  readonly dictionarySuggestions: readonly string[];
  readonly editFlags: {
    readonly canCut: boolean;
    readonly canCopy: boolean;
    readonly canPaste: boolean;
    readonly canSelectAll: boolean;
  };
}

/**
 * The right-click menu for text: Electron shows none of its own. Spelling suggestions first in a text
 * field, then Cut, Copy, Paste and Select All; selected text outside a field gets Copy only. The page
 * opens its own menus everywhere else, so anything else gets nothing (null).
 */
export function editMenuTemplate(
  p: EditMenuParams,
  fix: { replace(word: string): void; learn(word: string): void },
): MenuItemConstructorOptions[] | null {
  if (!p.isEditable) return p.selectionText.trim() ? [{ role: 'copy', enabled: p.editFlags.canCopy }] : null;
  const spelling: MenuItemConstructorOptions[] = [];
  if (p.misspelledWord) {
    for (const word of p.dictionarySuggestions.slice(0, 5))
      spelling.push({ label: word, click: () => fix.replace(word) });
    if (!spelling.length) spelling.push({ label: 'No Guesses Found', enabled: false });
    spelling.push(
      { label: 'Learn Spelling', click: () => fix.learn(p.misspelledWord) },
      { type: 'separator' },
    );
  }
  return [
    ...spelling,
    { role: 'cut', enabled: p.editFlags.canCut },
    { role: 'copy', enabled: p.editFlags.canCopy },
    { role: 'paste', enabled: p.editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: p.editFlags.canSelectAll },
  ];
}
