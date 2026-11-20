import path from 'node:path';
import { parseArgs } from 'node:util';
import { bindProblem, createServer, defaultStaticDir, parseHosts, parsePort } from './server.ts';

/**
 * playlark-server (PRD §18): `playlark-server --dir <music folder> [--port <n>] [--host <address>] [--no-auth]`.
 * Each option can come from the environment instead, which is how the Docker image sets them:
 *   PLAYLARK_MUSIC    the music folder; without one the server serves the web client alone
 *   PLAYLARK_PORT     port (default 8830)
 *   PLAYLARK_HOST     bind address (default 127.0.0.1)
 *   PLAYLARK_NO_AUTH  1 = listen on an address other machines reach; only behind a reverse proxy with a login
 *   PLAYLARK_HOSTS    host names the server is reached by (comma-separated); localhost and IPs always work
 *   PLAYLARK_STATIC   the built web client (default ../web/dist); empty = API only
 */
const env = process.env;
const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    port: { type: 'string' },
    host: { type: 'string' },
    'no-auth': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log('Usage: playlark-server --dir <music folder> [--port <n>] [--host <address>] [--no-auth]');
  process.exit(0);
}

const dir = values.dir ?? env.PLAYLARK_MUSIC;
const staticDir =
  env.PLAYLARK_STATIC === ''
    ? null
    : env.PLAYLARK_STATIC !== undefined
      ? path.resolve(env.PLAYLARK_STATIC)
      : defaultStaticDir(import.meta.url);
const port = parsePort(values.port ?? env.PLAYLARK_PORT);
const host = values.host ?? env.PLAYLARK_HOST ?? '127.0.0.1';
const problem = bindProblem(host, values['no-auth'] === true || env.PLAYLARK_NO_AUTH === '1');
if (problem) {
  console.error(problem);
  process.exit(1);
}

const musicDir = dir ? path.resolve(dir) : null;
const server = createServer({ staticDir, musicDir, allowedHosts: parseHosts(env.PLAYLARK_HOSTS) });
server.listen(port, host, () => {
  console.log(`Playlark listening on http://${host}:${port}`);
  console.log(musicDir ? `  music in ${musicDir}` : '  no --dir: each browser opens its own folder');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close(() => process.exit(0)));
