import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { indexFolder } from '@playlark/node-files';
import { ServerLibrary } from '../src/index.ts';

const BASIC = fileURLToPath(new URL('../../../e2e/fixtures/basic/', import.meta.url));
const COVERS = fileURLToPath(new URL('../../../e2e/fixtures/covers/', import.meta.url));

let library: ServerLibrary | null = null;
let dir = '';
afterEach(() => {
  library?.close();
  rmSync(dir, { recursive: true, force: true });
});

const songCount = (l: ServerLibrary) =>
  l.index ? (JSON.parse(l.index.text) as { songs: [] }).songs.length : 0;

describe('ServerLibrary', () => {
  it('scans again when the music folder is deleted and made again (PRD §18.3)', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'playlark-library-'));
    const music = path.join(dir, 'Music');
    cpSync(COVERS, music, { recursive: true });
    const lib = new ServerLibrary({
      root: music,
      name: 'Music',
      data: indexFolder(path.join(dir, 'data')),
      settleMs: 50,
    });
    library = lib;
    await lib.start();
    await expect.poll(() => songCount(lib)).toBe(2);

    rmSync(music, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 200));
    cpSync(BASIC, music, { recursive: true });
    await expect.poll(() => songCount(lib), { timeout: 5_000 }).toBe(7);
  });
});
