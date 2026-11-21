// Where the scenarios and the driver find the app: the NAS server serving the built client and the fixture folder.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The music folder the server serves: a fresh copy of a fixture for each test. Never real music. */
export const DATA = `${ROOT}.e2e-data/Music`;
/** A port no other app's checks use, so two apps' checks can run at once (the dev server uses 8830). */
export const PORT = 8831;
/** The server's own data folder: index, covers, favourites and trash. */
export const SERVER_DATA = `${ROOT}.e2e-data/server`;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

export const SERVER_COMMAND = ['apps/server/src/main.ts'];
// The server's own settings, with the app's prefix on every one, the port too: a server that ignores the port
// starts on its default one and the scenarios wait for it until they time out.
export const SERVER_ENV: Record<string, string> = {
  PLAYLARK_PORT: String(PORT),
  PLAYLARK_HOST: '127.0.0.1',
  PLAYLARK_STATIC: `${ROOT}apps/web/dist`,
  PLAYLARK_MUSIC: DATA,
  PLAYLARK_DATA: SERVER_DATA,
};

/** Replace .e2e-data with a fresh copy of e2e/fixtures/<fixture>. Never point this at real data. */
export function seedData(fixture: string): void {
  rmSync(DATA, { recursive: true, force: true });
  // Favourites and play counts start empty too; the server reads them afresh on each request.
  rmSync(`${SERVER_DATA}/stats.json`, { force: true });
  mkdirSync(DATA, { recursive: true });
  cpSync(fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url)), DATA, { recursive: true });
}
