import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIBRARIES_FOLDER, libraryDir, useLibrary } from '../src/index.ts';

let dir: string;
let data: string;
const folders: string[] = [];
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'playlark-libraries-'));
  data = path.join(dir, 'data');
  folders.length = 0;
  for (const name of ['A', 'B', 'C', 'D']) {
    const f = path.join(dir, name);
    await mkdir(f);
    folders.push(f);
  }
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
const kept = async () => (await readdir(path.join(data, LIBRARIES_FOLDER))).length;

describe('one index per music folder', () => {
  it('gives a folder and a link to it the same place', async () => {
    const link = path.join(dir, 'link');
    await symlink(folders[0]!, link);
    expect(await libraryDir(data, link)).toBe(await libraryDir(data, folders[0]!));
    expect(await libraryDir(data, folders[1]!)).not.toBe(await libraryDir(data, folders[0]!));
  });

  it('keeps the three folders used last', async () => {
    for (const [i, f] of folders.entries()) await useLibrary(data, f, [], at(i));
    expect(await kept()).toBe(3);
    const names = await readdir(path.join(data, LIBRARIES_FOLDER));
    expect(names).not.toContain(path.basename(await libraryDir(data, folders[0]!)));
  });

  it('never deletes the folder the desktop app remembers', async () => {
    for (const [i, f] of folders.entries()) await useLibrary(data, f, [folders[0]!], at(i));
    const names = await readdir(path.join(data, LIBRARIES_FOLDER));
    expect(names).toContain(path.basename(await libraryDir(data, folders[0]!)));
    expect(names).not.toContain(path.basename(await libraryDir(data, folders[1]!)));
  });
});
