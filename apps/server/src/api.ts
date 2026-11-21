/**
 * The server's write API (PRD §18.2): playlists, song tags and the shared favourites and play counts. Every write
 * goes through the same checks as the desktop app's (§9.3, §11.3); `--read-only` refuses the music folder ones.
 */
import type http from 'node:http';
import {
  applyStatsChanges,
  encodeBase64,
  parseStatsChanges,
  parseStatsFile,
  parseTagEdit,
  writeStatsFile,
} from '@playlark/core';
import {
  type IndexFolder,
  type PlaylistResult,
  type TagResult,
  playlistResult,
  renamePlaylistFile,
  tagResult,
  trashPlaylistFile,
  writePlaylistFile,
  writeSongTags,
} from '@playlark/node-files';
import { FOLDER_STATUS, HttpError, sendJson } from './http.ts';

export interface ApiOptions {
  readonly root: string;
  /** The folder's name: the key its stats are kept under. */
  readonly name: string;
  readonly dataDir: string;
  readonly data: IndexFolder;
  readonly readOnly: boolean;
  /** Called after a write to the music folder, so the library is read again. */
  readonly changed: () => void;
}

export const PLAYLISTS_PREFIX = '/api/playlists/';
/** The most a request body may hold: a playlist, or a tag edit with a cover image in base64. */
const MAX_BODY = 32 * 1024 * 1024;

export const READ_ONLY_MESSAGE = 'This Playlark server is read-only.';

async function readBody(req: http.IncomingMessage): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'That is too big to send.');
    parts.push(chunk);
  }
  return new Uint8Array(Buffer.concat(parts));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  try {
    return JSON.parse(Buffer.from(await readBody(req)).toString('utf8')) as unknown;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'That isn’t JSON.');
  }
}

/** The status a write answers with; the body says why either way. */
function statusOf(result: PlaylistResult | TagResult): number {
  if (result.ok) return 200;
  return result.code === 'failed' ? 500 : FOLDER_STATUS[result.code];
}

/** The relative path after `prefix`, each part decoded, or null when it doesn't decode. */
export function pathAfter(prefix: string, pathname: string): string | null {
  try {
    return pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

/** A version from `If-Match: "<sha>"`, or null. */
function ifMatch(req: http.IncomingMessage): string | null {
  const v = req.headers['if-match'];
  return typeof v === 'string' && /^"[0-9a-f]{64}"$/.test(v) ? v.slice(1, -1) : null;
}

export function createApi(opts: ApiOptions) {
  // One stats write at a time, each reading what the last one wrote.
  let statsBusy: Promise<void> = Promise.resolve();
  const oneAtATime = async (work: () => Promise<void>): Promise<void> => {
    const before = statsBusy;
    let release = () => undefined as void;
    statsBusy = new Promise((resolve) => (release = resolve));
    await before;
    try {
      await work();
    } finally {
      release();
    }
  };
  const loadAll = async () => {
    const text = await opts.data.loadStats();
    const all = text === null ? new Map() : parseStatsFile(text);
    if (!all)
      throw new HttpError(500, 'The favourites and play counts file can’t be read, so it is left as it is.');
    return all;
  };
  const writable = () => {
    if (opts.readOnly) throw new HttpError(403, READ_ONLY_MESSAGE);
  };
  const reply = (res: http.ServerResponse, result: PlaylistResult | TagResult) => {
    if (!result.ok) return sendJson(res, statusOf(result), result);
    opts.changed();
    if (!('undo' in result) || !result.undo.cover) return sendJson(res, 200, result);
    // A cover in the undo edit travels as base64, as covers come in.
    const { cover } = result.undo;
    sendJson(res, 200, {
      ...result,
      undo: { ...result.undo, cover: { ...cover, data: encodeBase64(cover.data) } },
    });
  };

  return {
    async stats(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
      if (req.method === 'GET') {
        const all = await loadAll();
        return void res
          .writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          })
          .end(writeStatsFile(new Map([[opts.name, all.get(opts.name) ?? new Map()]])));
      }
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      const changes = parseStatsChanges(((await readJson(req)) as { changes?: unknown } | null)?.changes);
      if (!changes) throw new HttpError(400, 'Those aren’t stats changes.');
      await oneAtATime(async () => {
        const all = await loadAll();
        all.set(opts.name, applyStatsChanges(all.get(opts.name) ?? new Map(), changes));
        await opts.data.saveStats(writeStatsFile(all));
      });
      sendJson(res, 200, { ok: true });
    },

    async playlist(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
      const rel = pathAfter(PLAYLISTS_PREFIX, pathname);
      if (rel === null) throw new HttpError(400, 'Bad path');
      writable();
      const { root } = opts;
      if (req.method === 'PUT') {
        const base = req.headers['if-none-match'] === '*' ? null : ifMatch(req);
        if (base === null && req.headers['if-none-match'] !== '*')
          throw new HttpError(428, 'Say which version is being written over.');
        const data = await readBody(req);
        return reply(res, await playlistResult(() => writePlaylistFile(root, rel, data, base)));
      }
      if (req.method === 'POST') {
        const to = ((await readJson(req)) as { to?: unknown } | null)?.to;
        if (typeof to !== 'string') throw new HttpError(400, 'Say what to rename it to.');
        return reply(res, await playlistResult(() => renamePlaylistFile(root, rel, to)));
      }
      if (req.method === 'DELETE') {
        const base = ifMatch(req);
        if (base === null) throw new HttpError(428, 'Say which version is being deleted.');
        return reply(res, await playlistResult(() => trashPlaylistFile(root, rel, base, opts.dataDir)));
      }
      throw new HttpError(405, 'Method not allowed');
    },

    async tags(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      writable();
      const body = (await readJson(req)) as { path?: unknown; edit?: unknown; expected?: unknown } | null;
      const edit = parseTagEdit(body?.edit);
      const facts = body?.expected as { size?: unknown; mtime?: unknown } | null | undefined;
      const rel = body?.path;
      if (
        typeof rel !== 'string' ||
        !edit ||
        typeof facts?.size !== 'number' ||
        typeof facts.mtime !== 'number'
      )
        throw new HttpError(400, 'That isn’t a tag edit.');
      const want = { size: facts.size, mtime: facts.mtime };
      return reply(res, await tagResult(rel, () => writeSongTags(opts.root, rel, edit, want, opts.dataDir)));
    },
  };
}
