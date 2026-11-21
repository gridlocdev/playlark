import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { indexFolder, listMusicFiles, mediaReply } from '@playlark/node-files';
import { PLAYLISTS_PREFIX, createApi, pathAfter } from './api.ts';
import { HttpError, SECURITY_HEADERS, httpError, sendJson } from './http.ts';
import { ServerLibrary } from './library.ts';

/**
 * The NAS server (PRD §18): the built web client, and read access to one music folder. It has no accounts: on
 * anything but this machine it belongs behind a reverse proxy that asks for a login.
 */
export interface ServerOptions {
  /** The built web client, or null to serve nothing but the API. */
  readonly staticDir: string | null;
  /** The music folder, or null to serve the client alone (it then opens a folder in the browser). */
  readonly musicDir: string | null;
  /**
   * Host names answered besides localhost and IP addresses (`PLAYLARK_HOSTS`): the names the server is reached
   * by. Any other `Host` is refused, so a web page can't reach the folder by pointing its own name here.
   */
  readonly allowedHosts?: readonly string[];
  /** Where the index, covers, stats and trash are kept (never the music folder). Needed with a music folder. */
  readonly dataDir?: string;
  /** Refuse playlist and tag writes (§18.1). */
  readonly readOnly?: boolean;
  /** Read the folder on a timer instead of watching it (§18.3). */
  readonly poll?: boolean;
}

/** A server and the library it scans; `close` stops both. */
export interface PlaylarkServer {
  readonly http: http.Server;
  /** The scan and watch of the music folder, or null when there is none. */
  readonly library: ServerLibrary | null;
  close(): Promise<void>;
}

export const DEFAULT_PORT = 8830;

/** apps/web/dist beside this package. */
export function defaultStaticDir(moduleUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../../web/dist');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

const MEDIA_PREFIX = '/api/media/';
const COVERS_PREFIX = '/api/covers/';
/** A comment down each open event stream this often, so proxies don't close it. */
const KEEP_ALIVE_MS = 25_000;

type Api = ReturnType<typeof createApi>;

interface Context {
  readonly opts: ServerOptions;
  readonly library: ServerLibrary | null;
  readonly api: Api | null;
  readonly data: ReturnType<typeof indexFolder> | null;
}

export function createServer(opts: ServerOptions): PlaylarkServer {
  const name = opts.musicDir ? path.basename(opts.musicDir) : '';
  const data = opts.musicDir && opts.dataDir ? indexFolder(opts.dataDir) : null;
  const library =
    opts.musicDir && data
      ? new ServerLibrary({ root: opts.musicDir, name, data, ...(opts.poll ? { poll: true } : {}) })
      : null;
  const api =
    opts.musicDir && opts.dataDir && data && library
      ? createApi({
          root: opts.musicDir,
          name,
          dataDir: opts.dataDir,
          data,
          readOnly: opts.readOnly === true,
          changed: () => library.changed(),
        })
      : null;
  const ctx: Context = { opts, library, api, data };
  const server = http.createServer((req, res) => {
    handle(req, res, ctx).catch((e: unknown) => {
      const err = httpError(e);
      if (!(err instanceof HttpError)) console.error(err);
      if (res.headersSent) return void res.destroy();
      if (err instanceof HttpError) sendJson(res, err.status, { code: err.code, message: err.message });
      else sendJson(res, 500, { code: 'failed', message: 'Server error' });
    });
  });
  void library?.start().catch((e: unknown) => console.error('Couldn’t read the music folder:', e));
  return {
    http: server,
    library,
    close: () =>
      new Promise((resolve) => {
        library?.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/**
 * A write must come from the server's own page: a page elsewhere can send a form, but not with JSON or with PUT
 * and DELETE (those need the server's leave, which it never gives), and its `Origin` names another host.
 */
function sameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, ctx: Context): Promise<void> {
  const { opts, library, api } = ctx;
  if (!hostAllowed(req.headers.host, opts.allowedHosts ?? []))
    throw new HttpError(421, 'Unknown host: add it to PLAYLARK_HOSTS.');
  const url = new URL(req.url ?? '/', 'http://localhost');
  const read = req.method === 'GET' || req.method === 'HEAD';
  const head = req.method === 'HEAD';
  if (!read && !sameOrigin(req)) throw new HttpError(403, 'Forbidden');
  const p = url.pathname;
  if (p.startsWith('/api/')) {
    // The page asks first, to learn whether its music is here or in a folder the browser opens.
    if (p === '/api/info' && read)
      return sendJson(res, 200, {
        app: 'Playlark',
        name: opts.musicDir ? path.basename(opts.musicDir) : null,
        readOnly: !api || opts.readOnly === true,
      });
    if (!opts.musicDir) throw new HttpError(404, 'Not found');
    if (p === '/api/files' && read) return sendJson(res, 200, { files: await listMusicFiles(opts.musicDir) });
    if (p.startsWith(MEDIA_PREFIX) && read) return sendMedia(req, res, opts.musicDir, p, head);
    if (p === '/api/library' && read && library) return sendIndex(req, res, library);
    if (p === '/api/events' && req.method === 'GET' && library) return sendEvents(req, res, library);
    if (p.startsWith(COVERS_PREFIX) && read && ctx.data) return sendCover(res, ctx.data, p, head);
    if (api) {
      if (p === '/api/stats') return api.stats(req, res);
      if (p === '/api/tags') return api.tags(req, res);
      if (p.startsWith(PLAYLISTS_PREFIX)) return api.playlist(req, res, p);
    }
    throw new HttpError(read ? 404 : 405, read ? 'Not found' : 'Method not allowed');
  }
  if (!read) throw new HttpError(405, 'Method not allowed');
  if (!opts.staticDir) throw new HttpError(404, 'Not found');
  await serveStatic(res, opts.staticDir, p, head);
}

/** The server's index (§18.2), or 204 before its first scan; 304 when the page has it already. */
function sendIndex(req: http.IncomingMessage, res: http.ServerResponse, library: ServerLibrary): void {
  const index = library.index;
  if (!index) return void res.writeHead(204, { 'Cache-Control': 'no-store', ...SECURITY_HEADERS }).end();
  const headers = { ETag: index.etag, 'Cache-Control': 'no-cache', ...SECURITY_HEADERS };
  if (req.headers['if-none-match'] === index.etag) return void res.writeHead(304, headers).end();
  res.writeHead(200, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(index.text),
  });
  res.end(req.method === 'HEAD' ? undefined : index.text);
}

/** Server-sent events: each scan's progress and each change to the library (§18.2). */
function sendEvents(req: http.IncomingMessage, res: http.ServerResponse, library: ServerLibrary): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
    ...SECURITY_HEADERS,
  });
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (library.index) send('library', { etag: library.index.etag });
  const stop = library.subscribe((e) =>
    e.type === 'scan' ? send('scan', e.progress) : send('library', { etag: e.etag }),
  );
  const alive = setInterval(() => res.write(': alive\n\n'), KEEP_ALIVE_MS);
  req.on('close', () => {
    clearInterval(alive);
    stop();
  });
}

/** A cover the scan stored, named by its SHA-256, so it never changes (§18.2). */
async function sendCover(
  res: http.ServerResponse,
  data: ReturnType<typeof indexFolder>,
  pathname: string,
  head: boolean,
): Promise<void> {
  const id = pathname.slice(COVERS_PREFIX.length);
  const cover = /^[0-9a-f]{64}$/.test(id) ? await data.cover(id) : null;
  if (!cover) throw new HttpError(404, 'Not found');
  const bytes = await readFile(cover.file);
  res.writeHead(200, {
    'Content-Type': cover.mime,
    'Content-Length': bytes.length,
    'Cache-Control': 'public, max-age=31536000, immutable',
    ...SECURITY_HEADERS,
  });
  res.end(head ? undefined : bytes);
}

/** The relative path in `/api/media/<each part encoded>`, or null when it doesn't decode. */
export function mediaPath(pathname: string): string | null {
  return pathAfter(MEDIA_PREFIX, pathname);
}

async function sendMedia(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  root: string,
  pathname: string,
  head: boolean,
): Promise<void> {
  const rel = mediaPath(pathname);
  if (rel === null) throw new HttpError(400, 'Bad path');
  const reply = await mediaReply(root, rel, req.headers.range);
  res.writeHead(reply.status, { ...reply.headers, ...SECURITY_HEADERS });
  if (head || !reply.body || reply.body.end < reply.body.start) return void res.end();
  await pipeline(createReadStream(reply.body.file, { start: reply.body.start, end: reply.body.end }), res);
}

async function serveStatic(
  res: http.ServerResponse,
  root: string,
  pathname: string,
  head: boolean,
): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Bad path');
  }
  const base = path.resolve(root);
  let file = path.resolve(base, decoded.replace(/^\/+/, '') || 'index.html');
  if (file !== base && !file.startsWith(base + path.sep)) throw new HttpError(403, 'Forbidden');
  let s = await stat(file).catch(() => null);
  if (!s || s.isDirectory()) {
    // Single-page app: unknown routes get the shell.
    file = path.join(base, 'index.html');
    s = await stat(file).catch(() => null);
    if (!s) throw new HttpError(404, 'Web client not built: run `just build-web`');
  }
  // Only the build's own hashed bundles under <root>/assets/ are immutable.
  const hashed = path.relative(base, file).split(path.sep)[0] === 'assets';
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': s.size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SECURITY_HEADERS,
  });
  if (head) return void res.end();
  res.end(await readFile(file));
}

/** The port from PLAYLARK_PORT, or the default when it is unset or not a port number. */
export function parsePort(spec: string | undefined): number {
  const n = Number(spec);
  return spec && Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

/** Parses `PLAYLARK_HOSTS` (`nas.lan, music.example.com`) into lowercase host names. */
export function parseHosts(spec: string | undefined): string[] {
  return (spec ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether a request's `Host` is one the server answers: localhost, an IP address, or one of `allowed`. */
export function hostAllowed(hostHeader: string | undefined, allowed: readonly string[]): boolean {
  if (!hostHeader) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare) || bare.includes(':')) return true;
  return allowed.includes(bare);
}

/** Whether a bind address is reachable only from this machine. */
export function isLoopbackHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  return bare === 'localhost' || bare === '::1' || /^127\./.test(bare);
}

/**
 * Why the server must not start on `host`, or null when it may. With no accounts, anyone who reaches the server
 * can listen to the music folder, so an address other machines can reach needs `noAuth`: the owner's promise
 * that a reverse proxy in front asks for a login.
 */
export function bindProblem(host: string, noAuth: boolean): string | null {
  if (noAuth || isLoopbackHost(host)) return null;
  return (
    `Refusing to listen on ${host || 'all addresses'}: Playlark has no accounts, so anyone who reaches it could ` +
    'read your music folder. Put it behind a reverse proxy that asks for a login and set PLAYLARK_NO_AUTH=1 ' +
    '(or --no-auth), or listen on 127.0.0.1.'
  );
}
