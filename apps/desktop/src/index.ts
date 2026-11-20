// The desktop app's pure parts, for its tests. Electron starts from main.ts.
export { Channels, type FolderInfo, type NativeMenuItem } from './bridge.ts';
export { guardMainErrors } from './crashGuard.ts';
export { folderExists, folderInfo, loadFolderChoice, saveFolderChoice, startFolder } from './folderChoice.ts';
export { COVER_PREFIX, coverResponse, MEDIA_PREFIX, mediaPath, mediaResponse } from './media.ts';
export { editMenuTemplate, toTemplate, withStandardMenus, type EditMenuParams } from './menu.ts';
export {
  allowPermission,
  appFile,
  appRequestFile,
  dataPaths,
  HEADLESS_PREFIX,
  isAppUrl,
  isHeadless,
  removeStaleHeadlessProfiles,
  type DataPaths,
} from './paths.ts';
export {
  loadSavedWindow,
  parseSavedWindow,
  placeWindow,
  saveWindow,
  saveWindowSync,
  type Rect,
  type SavedWindow,
} from './windowState.ts';
