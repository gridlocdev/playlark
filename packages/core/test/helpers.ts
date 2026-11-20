import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LibraryFile, type ScanSource, memorySource } from '../src/index.ts';

export const AUDIO = fileURLToPath(new URL('./fixtures/audio/', import.meta.url));
export const LIBRARY = fileURLToPath(new URL('../../../e2e/fixtures/basic/', import.meta.url));

export async function fixture(path: string) {
  return memorySource(new Uint8Array(await readFile(path)));
}

/** The fixture folder as a scan source, listed the way the apps list it: every file, relative, "/"-separated. */
export function folderSource(root: string): ScanSource {
  const walk = async (dir: string): Promise<LibraryFile[]> => {
    const out: LibraryFile[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await walk(full)));
      else {
        const s = await stat(full);
        out.push({ path: relative(root, full).split(sep).join('/'), size: s.size, mtime: s.mtimeMs });
      }
    }
    return out;
  };
  return { list: () => walk(root), open: (f) => fixture(join(root, f.path)) };
}

/** ASCII text as bytes. */
export function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}
