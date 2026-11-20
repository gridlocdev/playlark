/** The music folder on disk (PRD §3): listing its music files and reaching one by its relative path, never outside it. */
import type { Dirent } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { type LibraryFile, isLibraryPath, isSkippedName } from '@playlark/core';
import { FolderError } from './errors.ts';

/**
 * Every music file under `root`, by relative "/"-separated path. Symlinked folders aren't followed (no loops), and
 * linked files are listed only when they lead to a file inside the folder, the only ones `resolveInside` serves.
 */
export async function listMusicFiles(root: string): Promise<LibraryFile[]> {
  const out: LibraryFile[] = [];
  const realRoot = await realpath(root);
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      // A folder that can't be read is left out; the root itself must be readable.
      if (rel === '') throw e;
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        if (isSkippedName(entry.name)) return;
        const full = path.join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return walk(full, relPath);
        if (!(entry.isFile() || entry.isSymbolicLink()) || !isLibraryPath(relPath)) return;
        // A broken link, a link out of the folder, or a file removed mid-scan isn't music here.
        const real = entry.isSymbolicLink() ? await realpath(full).catch(() => null) : full;
        if (real === null || (real !== full && !real.startsWith(realRoot + path.sep))) return;
        const s = await stat(full).catch(() => null);
        if (s?.isFile()) out.push({ path: relPath, size: s.size, mtime: Math.round(s.mtimeMs) });
      }),
    );
  };
  await walk(root, '');
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The absolute path of `rel` inside `root`. Refuses `..`, absolute paths, and links that lead outside the folder,
 * so a request for a song can never read any other file.
 */
export async function resolveInside(root: string, rel: string): Promise<string> {
  const parts = rel.split('/');
  if (
    rel === '' ||
    rel.includes('\0') ||
    rel.includes('\\') ||
    parts.some((p) => p === '' || p === '.' || p === '..')
  )
    throw new FolderError('outside', 'That path is outside the music folder.');
  const realRoot = await realpath(root);
  let real: string;
  try {
    real = await realpath(path.join(realRoot, ...parts));
  } catch {
    throw new FolderError('not-found', 'That file is not in the music folder.');
  }
  if (!real.startsWith(realRoot + path.sep))
    throw new FolderError('outside', 'That path is outside the music folder.');
  return real;
}

/** A parsed `Range: bytes=…` header: the first and last byte, both included. */
export type ByteRange = { readonly start: number; readonly end: number };

/** Reads a single-range header; null means "send the whole file", 'unsatisfiable' a 416. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

/** The Content-Type for a music file, by extension. */
export function audioMimeType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg';
    case '.flac':
      return 'audio/flac';
    case '.m4a':
    case '.mp4':
    case '.aac':
      return 'audio/mp4';
    case '.ogg':
    case '.oga':
      return 'audio/ogg';
    case '.opus':
      return 'audio/ogg; codecs=opus';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.wav':
    case '.wave':
      return 'audio/wav';
    default:
      return 'application/octet-stream';
  }
}

/** How to answer a request for a song's bytes: the status, the headers and the part of the file to send. */
export interface MediaReply {
  readonly status: 200 | 206 | 416;
  readonly headers: Readonly<Record<string, string>>;
  /** The file and the bytes to send (inclusive); absent for a 416. */
  readonly body?: { readonly file: string; readonly start: number; readonly end: number };
}

/**
 * Answers a request for the music file at `rel` with an optional Range header (PRD §16.1, §18.4). Only music
 * files inside the folder are served; anything else is a FolderError.
 */
export async function mediaReply(root: string, rel: string, range: string | undefined): Promise<MediaReply> {
  const file = await resolveInside(root, rel);
  if (!isLibraryPath(rel)) throw new FolderError('not-found', 'That is not a music file or a cover.');
  const info = await stat(file);
  if (!info.isFile()) throw new FolderError('not-found', 'That is not a music file.');
  const size = info.size;
  const base = {
    'Content-Type': audioMimeType(file),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  const r = parseRange(range, size);
  if (r === 'unsatisfiable')
    return { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' } };
  if (r === null || size === 0)
    return {
      status: 200,
      headers: { ...base, 'Content-Length': String(size) },
      body: { file, start: 0, end: size - 1 },
    };
  return {
    status: 206,
    headers: {
      ...base,
      'Content-Range': `bytes ${r.start}-${r.end}/${size}`,
      'Content-Length': String(r.end - r.start + 1),
    },
    body: { file, start: r.start, end: r.end },
  };
}
