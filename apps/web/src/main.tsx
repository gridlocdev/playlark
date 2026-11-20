import { effect } from '@preact/signals';
import { render } from 'preact';
import '@playlark/ui/styles.css';
import './app.css';
import {
  WebAudioEngine,
  browserFolderLibrary,
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
import { nativeBridge, type NativeFolder, type PlaylarkNative } from './app/native.ts';
import { menuSender, nativeMenu, watchMenuInputs } from './app/nativeMenu.ts';
import pkg from '../package.json';

/** How often the seek bar moves while playing. */
const TICK_MS = 250;

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
    engine: new WebAudioEngine(),
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
    volume: saved.volume,
    onVolume: (volume) => void settings.save({ ...settings.load(), volume }),
  });
  const catalog = buildCommands(app);
  render(<App app={app} catalog={catalog} />, root);

  effect(() => {
    const song = app.player.currentSong.value;
    document.title = song && app.player.state.value === 'playing' ? `${song.title} – Playlark` : 'Playlark';
  });
  listenForKeys(window, catalog, () => app.blocked());
  every(TICK_MS, () => app.player.tick());
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
