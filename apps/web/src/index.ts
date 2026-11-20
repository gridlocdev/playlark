// What the web app's tests reach. The page itself starts from main.tsx.
export {
  AppController,
  keyPath,
  type ControllerOptions,
  type DialogKind,
  type FolderChooser,
} from './app/controller.ts';
export { NOTICE_ACTION_MS, NOTICE_MS, type Notice } from './app/notices.ts';
export {
  MISSING,
  NEW_PLAYLIST,
  READ_ONLY,
  SAVE_RETRIES_MS,
  missingSong,
  type PlaylistInfo,
} from './app/playlists.ts';
export { addToQueue, playNext, removeFromQueue } from './app/queueActions.ts';
export { UNDO_LIMIT, UndoStack, type UndoStep } from './app/undo.ts';
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
  playlistMoved,
  replace,
  sameView,
  startHistory,
  type History,
  type View,
} from './app/views.ts';
export { NO_SELECTION, all, click, keep, only, selectedRows, step, type Selection } from './app/selection.ts';
