import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryLibrary, type AudioEngine, type DecodedSong, type LibrarySource } from '@playlark/ui';
import { AppController, buildCommands, type ControllerOptions, type FolderChooser } from '../src/index.ts';

export const LIBRARY = fileURLToPath(new URL('../../../e2e/fixtures/basic/', import.meta.url));

/** An engine that "decodes" any file as a 60 s song and plays it silently. */
export class FakeEngine implements AudioEngine {
  onEnded: (() => void) | null = null;
  onBlocked: (() => void) | null = null;
  playing: DecodedSong | null = null;
  at = 0;
  decode(): Promise<DecodedSong> {
    return Promise.resolve({ duration: 60 } as DecodedSong);
  }
  start(song: DecodedSong, offset: number) {
    this.playing = song;
    this.at = offset;
  }
  pause() {
    return Promise.resolve();
  }
  resume() {
    return Promise.resolve();
  }
  stop() {
    this.playing = null;
  }
  position() {
    return this.at;
  }
  setVolume() {}
}

/** The fixture folder, read into memory. */
export async function fixtureLibrary(root = LIBRARY): Promise<LibrarySource> {
  const files: Record<string, Uint8Array> = {};
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files[relative(root, full).split(sep).join('/')] = new Uint8Array(await readFile(full));
    }
  };
  await walk(root);
  return memoryLibrary('basic', files);
}

/** A folder chooser that hands out the fixture folder. */
export const fixtureFolders: FolderChooser = { choose: () => fixtureLibrary() };

export async function makeApp(options: Partial<ControllerOptions> = {}) {
  const engine = new FakeEngine();
  const app = new AppController({ engine, version: '0.0.0-test', folders: fixtureFolders, ...options });
  const catalog = buildCommands(app);
  return { app, catalog, engine };
}
