import { effect } from '@preact/signals';
import { render } from 'preact';
import '@playlark/ui/styles.css';
import './app.css';
import {
  WebAudioEngine,
  bridgeIndexStore,
  browserFolderLibrary,
  browserIndexStore,
  encodePath,
  every,
  browserSettings,
  listenForKeys,
  serverLibrary,
  urlLibrary,
} from '@playlark/ui';
import { App } from './app/App.tsx';
import { buildCommands } from './app/commands.ts';
import { AppController, type FolderChooser } from './app/controller.ts';
import { startMediaSession } from './app/mediaSession.ts';
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

function desktopFolders(bridge: PlaylarkNative): FolderChooser {
  return {
    choose: async () => {
      const folder = await bridge.folder.choose();
      return folder ? desktopLibrary(bridge, folder) : null;
    },
  };
}

/** The desktop app opens the folder used last (PRD §16.2). */
async function openDesktopFolder(app: AppController, bridge: PlaylarkNative): Promise<void> {
  const folder = await bridge.folder.current();
  if (folder?.missing)
    app.say(`The music folder ${folder.path} is gone. Open another one.`, { tone: 'error' });
  else if (folder) await app.open(desktopLibrary(bridge, folder));
}

async function start(): Promise<void> {
  const nas = native ? null : await serverLibrary();
  const settings = browserSettings();
  const saved = settings.load();
  const app = new AppController({
    engine: WebAudioEngine.forPage(),
    version: native?.version ?? pkg.version,
    ...(native
      ? { folders: desktopFolders(native) }
      : nas
        ? {}
        : canPickFolder
          ? { folders: browserFolders }
          : {}),
    ...(!native && !nas && !canPickFolder
      ? {
          cannotOpen:
            'Opening a music folder needs Chrome or Edge. Use the desktop app or a Playlark server instead.',
        }
      : {}),
    index: native
      ? bridgeIndexStore(native.index, (id) => `app://playlark/cover/${id}`)
      : browserIndexStore(),
    imageUrl: (bytes, mime) => URL.createObjectURL(new Blob([bytes], { type: mime })),
    volume: saved.volume,
    playback: () => settings.load(),
    onVolume: (volume) => void settings.save({ ...settings.load(), volume }),
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

  const opening = native ? openDesktopFolder(app, native) : nas ? app.open(nas) : Promise.resolve();
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
