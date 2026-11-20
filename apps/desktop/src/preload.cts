// Sandboxed preload: CommonJS, and it may only require('electron'), so the channel names from
// bridge.ts are repeated here. Keep them in step. It exposes exactly one object, `playlarkNative`.
import type { NativeMenuItem } from './bridge.ts';

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';

contextBridge.exposeInMainWorld('playlarkNative', {
  version: arg('playlark-version'),
  chrome: arg('playlark-chrome') === 'unified' ? 'unified' : 'native',
  setMenu: (items: readonly NativeMenuItem[]) => ipcRenderer.send('playlark:set-menu', items),
  onCommand: (fn: (id: string) => void) => ipcRenderer.on('playlark:command', (_e, id: string) => fn(id)),
  onFullScreen: (fn: (full: boolean) => void) =>
    ipcRenderer.on('playlark:full-screen', (_e, full: boolean) => fn(full)),
  folder: {
    current: () => ipcRenderer.invoke('playlark:current-folder'),
    choose: () => ipcRenderer.invoke('playlark:choose-folder'),
  },
  listFiles: () => ipcRenderer.invoke('playlark:list-files'),
  index: {
    load: () => ipcRenderer.invoke('playlark:load-index'),
    save: (text: string) => ipcRenderer.invoke('playlark:save-index', text),
    saveCover: (id: string, mime: string, data: Uint8Array) =>
      ipcRenderer.invoke('playlark:save-cover', id, mime, data),
    pruneCovers: (keep: readonly string[]) => ipcRenderer.invoke('playlark:prune-covers', keep),
    loadQueue: () => ipcRenderer.invoke('playlark:load-queue'),
    saveQueue: (text: string) => ipcRenderer.invoke('playlark:save-queue', text),
  },
});
