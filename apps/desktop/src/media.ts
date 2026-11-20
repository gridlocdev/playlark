/** Song bytes for the page at `app://playlark/media/<path>`, with Range support, from the music folder only (PRD §16.1). */
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { FolderError, mediaReply } from '@playlark/node-files';

export const MEDIA_PREFIX = '/media/';

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
