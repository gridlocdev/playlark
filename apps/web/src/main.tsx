import { effect } from '@preact/signals';
import { render } from 'preact';
import '@playlark/ui/styles.css';
import './app.css';
import './phone.css';
import {
  WebAudioEngine,
  bridgeIndexStore,
  browserFolderLibrary,
  browserIndexStore,
  encodePath,
  fileListLibrary,
  every,
  browserSettings,
  fileSettings,
  listenForKeys,
  connectServer,
  urlLibrary,
} from '@playlark/ui';
import { App } from './app/App.tsx';
import { buildCommands } from './app/commands.ts';
import { canPickFolderFiles, pickFolderFiles } from './app/folderInput.ts';
import { AppController, type FolderChooser } from './app/controller.ts';
import { startMediaSession } from './app/mediaSession.ts';
import { Preferences, applyAppearance } from './app/preferences.ts';
import { SAVE_STATS_MS } from './app/stats.ts';
import { nativeBridge, type NativeFolder, type PlaylarkNative } from './app/native.ts';
import { menuSender, nativeMenu, watchMenuInputs } from './app/nativeMenu.ts';
import pkg from '../package.json';

/** How often the seek bar moves while playing. */
const TICK_MS = 250;
/** How often the queue is checked for changes to keep (PRD §8.4). */
const KEEP_QUEUE_MS = 1_000;
/** How often open playlists are checked for changes made elsewhere (PRD §9.3). */
const CHECK_PLAYLISTS_MS = 15_000;

const root = document.getElementById('app')!;
const native = nativeBridge();

/** The desktop app's folder: listed over the bridge, read from `app://playlark/media/` (PRD §16.1). */
function desktopLibrary(bridge: PlaylarkNative, folder: NativeFolder) {
  return urlLibrary({
    kind: 'desktop',
    name: folder.name,
    where: folder.path,
    list: () => bridge.listFiles(),
    mediaUrl: (path) => `app://playlark/media/${encodePath(path)}`,
    playlists: bridge.playlists,
    tags: bridge.tags,
  });
}

/** Chrome and Edge open a folder with the File System Access API (PRD §17). */
const canPickFolder =
  typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

const browserFolders: FolderChooser = {
  choose: async () => {
    try {
      const pick = (
        globalThis as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }
      ).showDirectoryPicker;
      return browserFolderLibrary(await pick({ id: 'music', mode: 'read', startIn: 'music' }));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
  },
};

/** Firefox and Safari pick a folder with a file input instead, and hand over all its files at once (§17). */
const inputFolders: FolderChooser = {
  choose: async () => {
    const files = await pickFolderFiles();
    return files ? fileListLibrary(files) : null;
  },
};

const pickableFolders = canPickFolder ? browserFolders : canPickFolderFiles() ? inputFolders : null;

function desktopFolders(bridge: PlaylarkNative): FolderChooser {
  return {
    choose: async () => {
      const folder = await bridge.folder.choose();
      return folder ? desktopLibrary(bridge, folder) : null;
    },
    useDefault: async () => {
      const folder = await bridge.folder.useMusic();
      return folder ? desktopLibrary(bridge, folder) : null;
    },
  };
}

/**
 * The desktop app opens the folder used last (PRD §16.2). At first start, or when that folder is gone, it asks
 * which folder to play.
 */
async function openDesktopFolder(app: AppController, bridge: PlaylarkNative, rescan: boolean): Promise<void> {
  const folder = await bridge.folder.current();
  if (folder && !folder.missing) return app.open(desktopLibrary(bridge, folder), rescan);
  app.missingFolder.value = folder?.path ?? null;
  app.show('chooseFolder');
}

async function start(): Promise<void> {
  const local = native ? null : browserIndexStore();
  const server = local ? await connectServer(local) : null;
  const nas = server?.source ?? null;
  const settings = native
    ? fileSettings(
        await native.settings.load(),
        (text) => native.settings.save(text),
        (e: unknown) => console.warn('Could not keep the settings:', e),
      )
    : browserSettings();
  const prefs = new Preferences(settings);
  const saved = prefs.value.peek();
  const app = new AppController({
    engine: WebAudioEngine.forPage(),
    version: native?.version ?? pkg.version,
    ...(native
      ? { folders: desktopFolders(native) }
      : nas
        ? {}
        : pickableFolders
          ? { folders: pickableFolders }
          : {}),
    ...(!native && !nas && !pickableFolders
      ? {
          cannotOpen:
            'This browser can’t open a music folder. Use the desktop app or a Playlark server instead.',
        }
      : {}),
    index: native
      ? bridgeIndexStore(native.index, (id) => `app://playlark/cover/${id}`)
      : (server?.index ?? local ?? browserIndexStore()),
    imageUrl: (bytes, mime) => URL.createObjectURL(new Blob([bytes], { type: mime })),
    volume: saved.volume,
    playback: () => prefs.value.peek(),
    onVolume: (volume) => prefs.set({ volume }),
    preferences: prefs,
    ...(native ? { reveal: (path: string) => native.revealSong(path) } : {}),
  });
  effect(() => {
    const appearance = prefs.value.value.appearance;
    applyAppearance(document.documentElement, appearance);
    native?.setAppearance(appearance);
  });
  const catalog = buildCommands(app);
  render(<App app={app} catalog={catalog} />, root);

  effect(() => {
    const song = app.player.currentSong.value;
    document.title = song && app.player.state.value === 'playing' ? `${song.title} – Playlark` : 'Playlark';
  });
  listenForKeys(window, catalog, () => app.blocked());
  every(TICK_MS, () => app.tick());
  every(KEEP_QUEUE_MS, () => void app.keepQueue());
  every(SAVE_STATS_MS, () => void app.stats.flush());
  addEventListener('pagehide', () => {
    void app.keepQueue();
    void app.stats.flush();
  });
  every(CHECK_PLAYLISTS_MS, () => void app.playlists.checkOutside());
  addEventListener('focus', () => void app.playlists.checkOutside());
  startMediaSession(app, catalog);
  if (import.meta.env.DEV) Object.assign(globalThis, { playlark: { app, catalog } });

  if (native) {
    const html = document.documentElement.classList;
    html.toggle('pl-unified', native.chrome === 'unified');
    native.onFullScreen((full) => html.toggle('pl-fullscreen', full));
    native.onCommand((id) => {
      // Menu accelerators reach the app before the page; in a text field the field keeps its own keys.
      const inText = !!document.activeElement?.closest('input:not([type=range]), textarea, select');
      if (inText && !catalog.get(id)?.global) return;
      catalog.run(id);
    });
    const menu = menuSender((items) => native.setMenu(items));
    addEventListener('focus', () => {
      menu.forget();
      menu.send(nativeMenu(catalog));
    });
    watchMenuInputs(app, () => menu.send(nativeMenu(catalog)));
    menu.send(nativeMenu(catalog));
  }

  // The phone app (§18.5): keep the app's own files so it opens offline. Only a server's page has one.
  if (server && import.meta.env.PROD && 'serviceWorker' in navigator)
    navigator.serviceWorker
      .register('./sw.js')
      .catch((e: unknown) => console.warn('Playlark won’t open offline:', e));

  const opening = native
    ? openDesktopFolder(app, native, saved.rescanOnStart)
    : nas
      ? app.open(nas, saved.rescanOnStart)
      : Promise.resolve();
  // A server says when its folder changed (§18.2): read it again, reusing what the server read.
  server?.watch(() => void app.rescan());
  await opening.catch((e: unknown) => {
    console.error(e);
    app.say(`Couldn’t open the music folder: ${e instanceof Error ? e.message : String(e)}`, {
      tone: 'error',
    });
  });
}

start().catch((e: unknown) => {
  console.error(e);
  root.textContent = `Playlark couldn't start: ${e instanceof Error ? e.message : String(e)}`;
});
