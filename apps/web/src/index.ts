// What the web app's tests reach. The page itself starts from main.tsx.
export {
  AppController,
  NOTICE_ACTION_MS,
  NOTICE_MS,
  type ControllerOptions,
  type DialogKind,
  type FolderChooser,
  type Notice,
} from './app/controller.ts';
export { buildCommands } from './app/commands.ts';
export { cursorStep } from './app/cursor.ts';
export { menuSender, nativeMenu, watchMenuInputs } from './app/nativeMenu.ts';
export { shortcutGroups, type ShortcutGroup, type ShortcutLine } from './app/shortcuts.ts';
export {
  HISTORY_LIMIT,
  SONGS,
  back,
  forward,
  go,
  replace,
  sameView,
  startHistory,
  type History,
  type View,
} from './app/views.ts';
export { NO_SELECTION, all, click, keep, only, selectedRows, step, type Selection } from './app/selection.ts';
