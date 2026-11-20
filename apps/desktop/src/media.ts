/** Song bytes for the page at `app://playlark/media/<path>`, with Range support, from the music folder only (PRD §16.1). */
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { FolderError, type IndexFolder, mediaReply } from '@playlark/node-files';

export const MEDIA_PREFIX = '/media/';
export const COVER_PREFIX = '/cover/';

/** A stored cover at `app://playlark/cover/<sha256>` (PRD §3.2, §4.6). */
export async function coverResponse(index: IndexFolder, pathname: string): Promise<Response> {
  const cover = await index.cover(pathname.slice(COVER_PREFIX.length));
  if (!cover) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(await readFile(cover.file)), {
    headers: { 'Content-Type': cover.mime, 'Cache-Control': 'max-age=31536000, immutable' },
  });
}

/** The folder-relative path an `app://playlark/media/…` pathname names, or null when it is malformed. */
export function mediaPath(pathname: string): string | null {
  if (!pathname.startsWith(MEDIA_PREFIX)) return null;
  try {
    return pathname.slice(MEDIA_PREFIX.length).split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

/** Answers a media request against `root` (null: no folder is open). */
export async function mediaResponse(
  root: string | null,
  pathname: string,
  range: string | null,
): Promise<Response> {
  const rel = mediaPath(pathname);
  if (!root || rel === null) return new Response('Not found', { status: 404 });
  try {
    const reply = await mediaReply(root, rel, range ?? undefined);
    if (!reply.body || reply.body.end < reply.body.start)
      return new Response(null, { status: reply.status, headers: reply.headers });
    const stream = createReadStream(reply.body.file, { start: reply.body.start, end: reply.body.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: reply.status,
      headers: reply.headers,
    });
  } catch (e) {
    if (e instanceof FolderError)
      return new Response(e.message, { status: e.code === 'outside' ? 403 : 404 });
    throw e;
  }
}
