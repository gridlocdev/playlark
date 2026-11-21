/**
 * Playlark desktop (PRD §16): one window running the web build from app://playlark/. The page reaches the main
 * process only through the preload's `playlarkNative`, and song bytes through app://playlark/media/.
 */
// First, so a headless run's error guard is in place before any other module runs.
import './headlessStart.ts';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  shell,
} from 'electron';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  emptyOldTrash,
  indexFolder,
  type IndexFolder,
  listMusicFiles,
  playlistResult,
  resolveInside,
  type PlaylistResult,
  renamePlaylistFile,
  tagResult,
  trashPlaylistFile,
  useLibrary,
  writePlaylistFile,
  writeSongTags,
} from '@playlark/node-files';
import { parseTagEdit } from '@playlark/core';
import { Channels, type FolderInfo } from './bridge.ts';
import { folderExists, folderInfo, saveFolderChoice, startFolder } from './folderChoice.ts';
import { COVER_PREFIX, MEDIA_PREFIX, coverResponse, mediaResponse } from './media.ts';
import { editMenuTemplate, toTemplate, withStandardMenus } from './menu.ts';
import {
  allowPermission,
  appRequestFile,
  dataPaths,
  HEADLESS_PREFIX,
  isAppUrl,
  isHeadless,
  removeStaleHeadlessProfiles,
} from './paths.ts';
import { loadSettingsText, saveSettingsText, themeSourceOf } from './settingsFile.ts';
import { loadSavedWindow, placeWindow, saveWindow, saveWindowSync, type SavedWindow } from './windowState.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, 'web');
const DEFAULT_SIZE = { width: 1100, height: 720 };
const MIN_SIZE = { width: 720, height: 420 };
const unified = process.platform === 'darwin';
/**
 * `--headless` or PLAYLARK_HEADLESS=1 (automated checks): render offscreen, muted, on a throwaway profile, and
 * never put a window, Dock icon, dialog or other app on the owner's screen (PRD §16.3). Native UI it would have
 * shown is recorded in `globalThis.playlarkHeadless` for the checks to read instead.
 */
const headless = isHeadless(process.argv, process.env);
interface HeadlessLog {
  /** Labels of each context menu that would have opened. */
  readonly contextMenus: string[][];
  /** Links that would have opened in the browser. */
  readonly openedLinks: string[];
  /** Files that would have been shown in Finder or File Explorer. */
  readonly revealed: string[];
  /** Dialogs that would have been shown; each is answered with Cancel. */
  readonly dialogs: string[];
}
const headlessLog: HeadlessLog = { contextMenus: [], openedLinks: [], dialogs: [], revealed: [] };
if (headless) (globalThis as { playlarkHeadless?: HeadlessLog }).playlarkHeadless = headlessLog;

const paths = dataPaths(process.env, headless, () => {
  removeStaleHeadlessProfiles(tmpdir());
  return mkdtempSync(path.join(tmpdir(), HEADLESS_PREFIX));
});
if (paths.userData) app.setPath('userData', paths.userData);
const windowFile = path.join(app.getPath('userData'), 'window-state.json');
const folderFile = path.join(app.getPath('userData'), 'folder.json');
const settingsFile = path.join(app.getPath('userData'), 'settings.json');

// A music player starts sound from menu items and media keys, which don't count as a gesture on the page.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win: BrowserWindow | null = null;
/** The music folder in use, or null before one is chosen. */
let musicFolder: string | null = null;
/**
 * The open folder's index, covers, queue and stats (PRD §3.2): its own folder in the data folder, never the music
 * folder. The last few folders keep theirs, so switching back is quick (§16.2).
 */
let index: IndexFolder | null = null;

async function useFolder(folder: string | null): Promise<void> {
  musicFolder = folder;
  index = folder ? indexFolder(await useLibrary(app.getPath('userData'), folder)) : null;
}

/** The Music folder Use Music Folder opens. A headless run has none unless a check names one. */
function usualMusicFolder(): string | null {
  if (process.env.PLAYLARK_USUAL_MUSIC) return path.resolve(process.env.PLAYLARK_USUAL_MUSIC);
  return headless ? null : app.getPath('music');
}
let lastWindow: SavedWindow | null = null;

/** Only our own page may use the bridge. */
function trusted(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return isAppUrl(e.senderFrame?.url);
}

/** Saves where the window is. On close it saves before returning, since the app quits right after. */
function rememberWindow(w: BrowserWindow, closing = false): void {
  if (headless || w.isDestroyed() || w.isMinimized()) return;
  const b = w.getNormalBounds();
  lastWindow = { ...b, maximized: w.isMaximized() };
  const failed = (e: unknown) => console.warn('Could not remember the window position:', e);
  if (!closing) {
    void saveWindow(windowFile, lastWindow).catch(failed);
    return;
  }
  try {
    saveWindowSync(windowFile, lastWindow);
  } catch (e) {
    failed(e);
  }
}

function createWindow(): BrowserWindow {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const fallback = {
    x: area.x + Math.round((area.width - DEFAULT_SIZE.width) / 2),
    y: area.y + Math.round((area.height - DEFAULT_SIZE.height) / 3),
    width: Math.min(DEFAULT_SIZE.width, area.width),
    height: Math.min(DEFAULT_SIZE.height, area.height),
  };
  const placed = placeWindow(
    headless ? null : lastWindow,
    screen.getAllDisplays().map((d) => d.workArea),
    fallback,
    MIN_SIZE,
  );
  const w = new BrowserWindow({
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'Playlark',
    ...(unified ? { titleBarStyle: 'hiddenInset' as const } : {}),
    // macOS ignores this and shows the bundle's icon.icns.
    ...(process.platform === 'darwin' ? {} : { icon: path.join(here, '..', 'build', 'icon.png') }),
    show: false,
    // The page's window grey (--pl-window), so a slow first paint doesn't flash.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#232325' : '#f3f3f4',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      offscreen: headless,
      backgroundThrottling: false,
      additionalArguments: [
        `--playlark-version=${app.getVersion()}`,
        `--playlark-chrome=${unified ? 'unified' : 'native'}`,
      ],
    },
  });
  if (headless) w.webContents.setAudioMuted(true);
  else
    w.once('ready-to-show', () => {
      if (placed.maximized) w.maximize();
      w.show();
    });
  let placeTimer: NodeJS.Timeout | null = null;
  const placeChanged = () => {
    if (placeTimer) clearTimeout(placeTimer);
    placeTimer = setTimeout(() => rememberWindow(w), 500);
  };
  for (const ev of ['move', 'resize', 'maximize', 'unmaximize'] as const) w.on(ev as 'move', placeChanged);
  w.on('enter-full-screen', () => w.webContents.send(Channels.fullScreen, true));
  w.on('leave-full-screen', () => w.webContents.send(Channels.fullScreen, false));
  w.on('close', () => {
    if (placeTimer) clearTimeout(placeTimer);
    rememberWindow(w, true);
  });
  w.on('closed', () => {
    if (placeTimer) clearTimeout(placeTimer);
    if (win === w) win = null;
  });

  // Electron shows no menu of its own on right-click; text fields get the edit menu.
  w.webContents.on('context-menu', (_e, params) => {
    const template = editMenuTemplate(params, {
      replace: (word) => w.webContents.replaceMisspelling(word),
      learn: (word) => w.webContents.session.addWordToSpellCheckerDictionary(word),
    });
    if (!template) return;
    if (headless) headlessLog.contextMenus.push(template.map((item) => item.label ?? item.role ?? '-'));
    else Menu.buildFromTemplate(template).popup({ window: w });
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^(https?|mailto):/i.test(url)) return { action: 'deny' };
    if (headless) headlessLog.openedLinks.push(url);
    else void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Any frame, not only the main one, stays on the app's own pages.
  w.webContents.on('will-frame-navigate', (e) => {
    if (!isAppUrl(e.url)) e.preventDefault();
  });
  void w.loadURL('app://playlark/index.html');
  return w;
}

function registerIpc(): void {
  const refuse = () => Promise.reject(new Error('Not our page.'));
  ipcMain.handle(Channels.currentFolder, async (e): Promise<FolderInfo | null> => {
    if (!trusted(e)) return refuse();
    const folder = await startFolder(process.env, folderFile);
    if (!folder) return null;
    const info = await folderInfo(folder);
    await useFolder(info.missing ? null : folder);
    return info;
  });
  ipcMain.handle(Channels.useMusicFolder, async (e): Promise<FolderInfo | null> => {
    if (!trusted(e)) return refuse();
    const dir = usualMusicFolder();
    if (!dir) headlessLog.dialogs.push('Use Music Folder');
    if (!dir || !(await folderExists(dir))) return null;
    await saveFolderChoice(folderFile, dir);
    await useFolder(dir);
    return folderInfo(dir);
  });
  // Show in Finder (§14): only a file inside the open folder, and never on the owner's screen in a headless run.
  ipcMain.handle(Channels.revealSong, async (e, rel: unknown) => {
    if (!trusted(e) || typeof rel !== 'string') return refuse();
    if (!musicFolder) throw new Error('No music folder is open.');
    const file = await resolveInside(musicFolder, rel);
    if (headless) headlessLog.revealed.push(file);
    else shell.showItemInFolder(file);
  });
  ipcMain.handle(Channels.loadSettings, (e) => (trusted(e) ? loadSettingsText(settingsFile) : refuse()));
  ipcMain.handle(Channels.saveSettings, (e, text: unknown) =>
    trusted(e) ? saveSettingsText(settingsFile, text) : refuse(),
  );
  ipcMain.on(Channels.setAppearance, (e, appearance: unknown) => {
    if (!trusted(e) || (appearance !== 'system' && appearance !== 'light' && appearance !== 'dark')) return;
    nativeTheme.themeSource = appearance;
  });
  ipcMain.handle(Channels.chooseFolder, async (e): Promise<FolderInfo | null> => {
    if (!trusted(e)) return refuse();
    if (headless || !win) {
      headlessLog.dialogs.push('Open Music Folder');
      return null;
    }
    const picked = await dialog.showOpenDialog(win, {
      title: 'Open Music Folder',
      buttonLabel: 'Open',
      defaultPath: musicFolder ?? app.getPath('music'),
      properties: ['openDirectory'],
    });
    const dir = picked.filePaths[0];
    if (picked.canceled || !dir || !(await folderExists(dir))) return null;
    await saveFolderChoice(folderFile, dir);
    await useFolder(dir);
    return folderInfo(dir);
  });
  ipcMain.handle(Channels.listFiles, (e) => {
    if (!trusted(e)) return refuse();
    if (!musicFolder) return Promise.reject(new Error('No music folder is open.'));
    return listMusicFiles(musicFolder);
  });
  // The index calls need a folder open: each folder has its own (§16.2).
  const withIndex = <T>(e: Electron.IpcMainInvokeEvent, ok: boolean, use: (i: IndexFolder) => Promise<T>) => {
    if (!trusted(e) || !ok) return refuse();
    return index ? use(index) : Promise.reject(new Error('No music folder is open.'));
  };
  const isText = (v: unknown): v is string => typeof v === 'string';
  ipcMain.handle(Channels.loadIndex, (e) => withIndex(e, true, (i) => i.load()));
  ipcMain.handle(Channels.saveIndex, (e, text: unknown) =>
    withIndex(e, isText(text), (i) => i.save(text as string)),
  );
  ipcMain.handle(Channels.saveCover, (e, id: unknown, mime: unknown, data: unknown) =>
    withIndex(e, isText(id) && isText(mime) && data instanceof Uint8Array, (i) =>
      i.saveCover(id as string, mime as string, data as Uint8Array),
    ),
  );
  ipcMain.handle(Channels.loadQueue, (e) => withIndex(e, true, (i) => i.loadQueue()));
  ipcMain.handle(Channels.saveQueue, (e, text: unknown) =>
    withIndex(e, isText(text), (i) => i.saveQueue(text as string)),
  );
  ipcMain.handle(Channels.loadStats, (e) => withIndex(e, true, (i) => i.loadStats()));
  ipcMain.handle(Channels.saveStats, (e, text: unknown) =>
    withIndex(e, isText(text), (i) => i.saveStats(text as string)),
  );
  ipcMain.handle(Channels.pruneCovers, (e, keep: unknown) =>
    withIndex(e, Array.isArray(keep) && keep.every(isText), (i) => i.pruneCovers(new Set(keep as string[]))),
  );
  // Playlist writes (PRD §9.3): refused unless a folder is open; the outcome comes back as a PlaylistResult.
  const inFolder = (write: (root: string) => Promise<string>): Promise<PlaylistResult> => {
    const root = musicFolder;
    if (!root) return Promise.resolve({ ok: false, code: 'failed', message: 'No music folder is open.' });
    return playlistResult(() => write(root));
  };
  ipcMain.handle(Channels.writePlaylist, (e, rel: unknown, data: unknown, base: unknown) => {
    if (!trusted(e) || !isText(rel) || !(data instanceof Uint8Array) || !(base === null || isText(base)))
      return refuse();
    return inFolder((root) => writePlaylistFile(root, rel, data, base));
  });
  ipcMain.handle(Channels.renamePlaylist, (e, from: unknown, to: unknown) => {
    if (!trusted(e) || !isText(from) || !isText(to)) return refuse();
    return inFolder((root) => renamePlaylistFile(root, from, to));
  });
  ipcMain.handle(Channels.trashPlaylist, (e, rel: unknown, base: unknown) => {
    if (!trusted(e) || !isText(rel) || !isText(base)) return refuse();
    return inFolder((root) => trashPlaylistFile(root, rel, base, app.getPath('userData')));
  });
  // Song Info saves (PRD §11.3): the original goes to the trash in the app's data folder.
  ipcMain.handle(Channels.writeTags, (e, rel: unknown, value: unknown, expected: unknown) => {
    const edit = parseTagEdit(value);
    const facts = expected as { size?: unknown; mtime?: unknown } | null;
    if (
      !trusted(e) ||
      !isText(rel) ||
      !edit ||
      typeof facts?.size !== 'number' ||
      typeof facts.mtime !== 'number'
    )
      return refuse();
    const root = musicFolder;
    if (!root) return { ok: false, code: 'failed', message: 'No music folder is open.' };
    const want = { size: facts.size, mtime: facts.mtime };
    return tagResult(rel, () => writeSongTags(root, rel, edit, want, app.getPath('userData')));
  });
  ipcMain.on(Channels.setMenu, (e, items: unknown) => {
    if (!trusted(e) || !Array.isArray(items)) return;
    const send = (id: string) => win?.webContents.send(Channels.command, id);
    try {
      const template = withStandardMenus(toTemplate(items, send), process.platform, !app.isPackaged);
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    } catch (error) {
      // A bad accelerator, say: keep the menu bar there is rather than stop the main process.
      console.warn('Could not build the menu bar:', error);
    }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    // A headless run never brings anything forward.
    if (!win || headless) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  void app.whenReady().then(async () => {
    // Until the page sends its menu: no reload or developer tools in a packaged app.
    Menu.setApplicationMenu(Menu.buildFromTemplate(withStandardMenus([], process.platform, !app.isPackaged)));
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done, details) =>
      done(allowPermission(permission, details.requestingUrl)),
    );
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin, details) =>
      allowPermission(permission, details.requestingUrl ?? origin),
    );
    protocol.handle('app', (req) => {
      const url = new URL(req.url);
      if (url.host === 'playlark' && url.pathname.startsWith(MEDIA_PREFIX))
        return mediaResponse(musicFolder, url.pathname, req.headers.get('range'));
      if (url.host === 'playlark' && url.pathname.startsWith(COVER_PREFIX))
        return index ? coverResponse(index, url.pathname) : new Response('Not found', { status: 404 });
      const file = appRequestFile(webRoot, req.url);
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Forbidden', { status: 403 });
    });
    registerIpc();
    // The saved appearance before the window opens, so it starts in the right colours (PRD §19).
    const saved = await loadSettingsText(settingsFile).catch((e: unknown) => {
      console.warn('Could not read the settings:', e);
      return null;
    });
    nativeTheme.themeSource = themeSourceOf(saved);
    // Trash older than 30 days goes on start (PRD §11.4).
    await emptyOldTrash(app.getPath('userData'));
    lastWindow = await loadSavedWindow(windowFile);
    win = createWindow();
    app.on('activate', () => {
      if (!win) win = createWindow();
    });
  });
  // One window: closing it quits, on every platform (PRD §16.1).
  app.on('window-all-closed', () => app.quit());
}
