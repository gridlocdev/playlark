/** The music folder on disk as a scan source (PRD §3.3), for the NAS server and the CLI. */
import { open } from 'node:fs/promises';
import type { ByteSource, ScanSource } from '@playlark/core';
import { listMusicFiles, resolveInside } from './musicFolder.ts';

/** A file read a range at a time; each read opens and closes the file, so nothing stays open after a scan. */
export function diskByteSource(file: string, size: number): ByteSource {
  return {
    size,
    read: async (offset, length) => {
      const start = Math.max(0, Math.min(offset, size));
      const want = Math.max(0, Math.min(length, size - start));
      if (want === 0) return new Uint8Array();
      const handle = await open(file, 'r');
      try {
        const out = new Uint8Array(want);
        let at = 0;
        while (at < want) {
          const { bytesRead } = await handle.read(out, at, want - at, start + at);
          if (bytesRead === 0) break;
          at += bytesRead;
        }
        return at === want ? out : out.subarray(0, at);
      } finally {
        await handle.close();
      }
    },
  };
}

/** Every music and playlist file under `root`, each opened inside it (links that leave it are refused). */
export function folderScanSource(root: string): ScanSource {
  return {
    list: () => listMusicFiles(root),
    open: async (f) => diskByteSource(await resolveInside(root, f.path), f.size),
  };
}
