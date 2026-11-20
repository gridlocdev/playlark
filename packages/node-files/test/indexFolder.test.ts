import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexFolder } from '../src/index.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'playlark-index-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('the index folder', () => {
  it('saves and loads the index, and starts with none', async () => {
    const f = indexFolder(dir);
    expect(await f.load()).toBeNull();
    await f.save('{"format":1}');
    expect(await f.load()).toBe('{"format":1}');
  });

  it('stores each cover once, finds it by id, and prunes the unused ones', async () => {
    const f = indexFolder(dir);
    await f.saveCover(A, 'image/png', new Uint8Array([1]));
    await f.saveCover(A, 'image/png', new Uint8Array([1]));
    await f.saveCover(B, 'image/jpeg', new Uint8Array([2]));
    expect(await readdir(path.join(dir, 'covers'))).toEqual([`${A}.png`, `${B}.jpg`]);
    expect(await f.cover(B)).toEqual({ file: path.join(dir, 'covers', `${B}.jpg`), mime: 'image/jpeg' });
    await f.pruneCovers(new Set([B]));
    expect(await f.cover(A)).toBeNull();
    expect(await f.cover('../x')).toBeNull();
    await expect(f.saveCover('../x', 'image/png', new Uint8Array())).rejects.toThrow();
  });
});
