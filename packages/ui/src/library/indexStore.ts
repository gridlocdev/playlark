/**
 * Where the library index and its covers are kept (PRD §3.2): the desktop app's data folder over the bridge, or
 * the browser's IndexedDB (the browser and the NAS client). The index is a cache: anything wrong with it means a
 * full scan, never an error the user sees.
 */
import {
  type LibraryIndex,
  type Picture,
  type SavedQueue,
  parseIndex,
  parseSavedQueue,
} from '@playlark/core';

export interface IndexStore {
  /** The saved index for `root`, or null. */
  load(root: string): Promise<LibraryIndex | null>;
  save(index: LibraryIndex): Promise<void>;
  saveCover(id: string, picture: Picture): Promise<void>;
  /** A URL an `<img>` can show for a stored cover, or null when there is none. */
  coverUrl(id: string): Promise<string | null>;
  /** Deletes every stored cover not in `keep`. */
  pruneCovers(keep: ReadonlySet<string>): Promise<void>;
  /** The queue kept from the last run in `root` (PRD §8.4), or null. */
  loadQueue(root: string): Promise<SavedQueue | null>;
  saveQueue(saved: SavedQueue): Promise<void>;
}

/** Kept in memory only: tests, and hosts that can't keep anything. */
export function memoryIndexStore(): IndexStore & { readonly covers: Map<string, Picture> } {
  let saved: string | null = null;
  let queue: string | null = null;
  const covers = new Map<string, Picture>();
  return {
    covers,
    load: (root) => Promise.resolve(saved === null ? null : parseIndex(saved, root)),
    save: (index) => {
      saved = JSON.stringify(index);
      return Promise.resolve();
    },
    saveCover: (id, picture) => {
      covers.set(id, picture);
      return Promise.resolve();
    },
    coverUrl: (id) => Promise.resolve(covers.has(id) ? `memory:${id}` : null),
    pruneCovers: (keep) => {
      for (const id of covers.keys()) if (!keep.has(id)) covers.delete(id);
      return Promise.resolve();
    },
    loadQueue: (root) => Promise.resolve(queue === null ? null : parseSavedQueue(queue, root)),
    saveQueue: (q) => {
      queue = JSON.stringify(q);
      return Promise.resolve();
    },
  };
}

/** What the desktop app's preload offers for the index (`playlarkNative.index`). */
export interface IndexBridge {
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
  saveCover(id: string, mime: string, data: Uint8Array): Promise<void>;
  pruneCovers(keep: readonly string[]): Promise<void>;
  loadQueue(): Promise<string | null>;
  saveQueue(text: string): Promise<void>;
}

/** The desktop app's data folder; covers are shown from `coverUrl(id)`, an address the app serves. */
export function bridgeIndexStore(bridge: IndexBridge, coverUrl: (id: string) => string): IndexStore {
  const known = new Set<string>();
  return {
    load: async (root) => {
      const text = await bridge.load();
      const index = text === null ? null : parseIndex(text, root);
      for (const s of index?.songs ?? []) if (s.cover?.kind === 'embedded') known.add(s.cover.id);
      return index;
    },
    save: (index) => bridge.save(JSON.stringify(index)),
    saveCover: async (id, picture) => {
      await bridge.saveCover(id, picture.mime, picture.data);
      known.add(id);
    },
    coverUrl: (id) => Promise.resolve(known.has(id) ? coverUrl(id) : null),
    pruneCovers: (keep) => bridge.pruneCovers([...keep]),
    loadQueue: async (root) => {
      const text = await bridge.loadQueue();
      return text === null ? null : parseSavedQueue(text, root);
    },
    saveQueue: (q) => bridge.saveQueue(JSON.stringify(q)),
  };
}

const DB_VERSION = 2;
const INDEX = 'index';
const COVERS = 'covers';
const QUEUE = 'queue';

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed.'));
  });
}

/** The browser's IndexedDB, one database per page origin. Covers are shown from object URLs. */
export function browserIndexStore(name = 'playlark'): IndexStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, DB_VERSION);
      request.onupgradeneeded = () => {
        const names = request.result.objectStoreNames;
        for (const store of [INDEX, COVERS, QUEUE])
          if (!names.contains(store)) request.result.createObjectStore(store);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB failed.'));
    });
    return db;
  };
  const store = async (which: string, mode: IDBTransactionMode) =>
    (await open()).transaction(which, mode).objectStore(which);
  const urls = new Map<string, string>();
  return {
    load: async (root) => {
      const text: unknown = await done((await store(INDEX, 'readonly')).get(root));
      return typeof text === 'string' ? parseIndex(text, root) : null;
    },
    save: async (index) => {
      await done((await store(INDEX, 'readwrite')).put(JSON.stringify(index), index.root));
    },
    saveCover: async (id, picture) => {
      const covers = await store(COVERS, 'readwrite');
      if ((await done(covers.count(id))) > 0) return;
      await done(covers.put(new Blob([picture.data as Uint8Array<ArrayBuffer>], { type: picture.mime }), id));
    },
    coverUrl: async (id) => {
      const have = urls.get(id);
      if (have) return have;
      const blob: unknown = await done((await store(COVERS, 'readonly')).get(id));
      if (!(blob instanceof Blob)) return null;
      const url = URL.createObjectURL(blob);
      urls.set(id, url);
      return url;
    },
    pruneCovers: async (keep) => {
      const covers = await store(COVERS, 'readwrite');
      const ids = (await done(covers.getAllKeys())).filter((k): k is string => typeof k === 'string');
      for (const id of ids) if (!keep.has(id)) await done(covers.delete(id));
    },
    loadQueue: async (root) => {
      const text: unknown = await done((await store(QUEUE, 'readonly')).get(root));
      return typeof text === 'string' ? parseSavedQueue(text, root) : null;
    },
    saveQueue: async (q) => {
      await done((await store(QUEUE, 'readwrite')).put(JSON.stringify(q), q.root));
    },
  };
}
