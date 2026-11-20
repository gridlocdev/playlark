import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { listMusicFiles, mediaReply } from '@playlark/node-files';
import { HttpError, SECURITY_HEADERS, httpError, sendJson } from './http.ts';

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

export function createServer(opts: ServerOptions): http.Server {
  return http.createServer((req, res) => {
    handle(req, res, opts).catch((e: unknown) => {
      const err = httpError(e);
      if (!(err instanceof HttpError)) console.error(err);
      if (res.headersSent) return void res.destroy();
      if (err instanceof HttpError) sendJson(res, err.status, { code: err.code, message: err.message });
      else sendJson(res, 500, { code: 'failed', message: 'Server error' });
    });
  });
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ServerOptions,
): Promise<void> {
  if (!hostAllowed(req.headers.host, opts.allowedHosts ?? []))
    throw new HttpError(421, 'Unknown host: add it to PLAYLARK_HOSTS.');
  const url = new URL(req.url ?? '/', 'http://localhost');
  const head = req.method === 'HEAD';
  if (req.method !== 'GET' && !head) throw new HttpError(405, 'Method not allowed');
  if (url.pathname.startsWith('/api/')) {
    // The page asks first, to learn whether its music is here or in a folder the browser opens.
    if (url.pathname === '/api/info')
      return sendJson(res, 200, {
        app: 'Playlark',
        name: opts.musicDir ? path.basename(opts.musicDir) : null,
      });
    if (!opts.musicDir) throw new HttpError(404, 'Not found');
    if (url.pathname === '/api/files')
      return sendJson(res, 200, { files: await listMusicFiles(opts.musicDir) });
    if (url.pathname.startsWith(MEDIA_PREFIX)) return sendMedia(req, res, opts.musicDir, url.pathname, head);
    throw new HttpError(404, 'Not found');
  }
  if (!opts.staticDir) throw new HttpError(404, 'Not found');
  await serveStatic(res, opts.staticDir, url.pathname, head);
}

/** The relative path in `/api/media/<each part encoded>`, or null when it doesn't decode. */
export function mediaPath(pathname: string): string | null {
  try {
    return pathname.slice(MEDIA_PREFIX.length).split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
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
