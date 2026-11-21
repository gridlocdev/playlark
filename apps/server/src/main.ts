import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { emptyOldTrash } from '@playlark/node-files';
import { bindProblem, createServer, defaultStaticDir, parseHosts, parsePort } from './server.ts';

/**
 * playlark-server (PRD §18): `playlark-server --dir <music folder> [--data <folder>] [--port <n>]
 * [--host <address>] [--read-only] [--poll] [--no-auth]`. Each option can come from the environment instead,
 * which is how the Docker image sets them:
 *   PLAYLARK_MUSIC      the music folder; without one the server serves the web client alone
 *   PLAYLARK_DATA       the index, covers, favourites and trash (default ~/.local/share/playlark-server)
 *   PLAYLARK_PORT       port (default 8830)
 *   PLAYLARK_HOST       bind address (default 127.0.0.1)
 *   PLAYLARK_READ_ONLY  1 = no playlist or tag writes
 *   PLAYLARK_POLL       1 = read the folder every minute instead of watching it (SMB and NFS mounts)
 *   PLAYLARK_NO_AUTH    1 = listen on an address other machines reach; only behind a reverse proxy with a login
 *   PLAYLARK_HOSTS      host names the server is reached by (comma-separated); localhost and IPs always work
 *   PLAYLARK_STATIC     the built web client (default ../web/dist); empty = API only
 */
const env = process.env;
const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    data: { type: 'string' },
    port: { type: 'string' },
    host: { type: 'string' },
    'read-only': { type: 'boolean' },
    poll: { type: 'boolean' },
    'no-auth': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(
    'Usage: playlark-server --dir <music folder> [--data <folder>] [--port <n>] [--host <address>] ' +
      '[--read-only] [--poll] [--no-auth]',
  );
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
const dataDir = path.resolve(
  values.data ??
    env.PLAYLARK_DATA ??
    path.join(env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'), 'playlark-server'),
);
const readOnly = values['read-only'] === true || env.PLAYLARK_READ_ONLY === '1';
if (musicDir) {
  await mkdir(dataDir, { recursive: true });
  await emptyOldTrash(dataDir).catch((e: unknown) => console.error('Couldn’t empty the old trash:', e));
}
const server = createServer({
  staticDir,
  musicDir,
  ...(musicDir ? { dataDir } : {}),
  readOnly,
  poll: values.poll === true || env.PLAYLARK_POLL === '1',
  allowedHosts: parseHosts(env.PLAYLARK_HOSTS),
});
server.http.listen(port, host, () => {
  console.log(`Playlark listening on http://${host}:${port}`);
  if (!musicDir) console.log('  no --dir: each browser opens its own folder');
  else console.log(`  music in ${musicDir}${readOnly ? ' (read-only)' : ''}\n  data in ${dataDir}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => void server.close().then(() => process.exit(0)));
