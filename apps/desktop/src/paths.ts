/** Where the desktop app keeps its own files (PRD §12). No Electron imports, so the tests run it in Node. */
import { lstatSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/** The start of the name of each headless run's profile folder in the system's temporary folder. */
export const HEADLESS_PREFIX = 'playlark-headless-';
/** A profile younger than this may belong to a run that is still starting. */
const STALE_MS = 60_000;

export interface DataPaths {
  /** Overrides Electron's user-data folder, or null for the default. */
  readonly userData: string | null;
  /** The folder was made for this run, in the system's temporary folder. */
  readonly temporary: boolean;
}

/**
 * Headless mode, for automated checks: `--headless` on the command line or PLAYLARK_HEADLESS=1. The app renders
 * offscreen and never shows a window, a Dock icon, a menu or anything else on the owner's screen.
 */
export function isHeadless(argv: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return argv.includes('--headless') || env.PLAYLARK_HEADLESS === '1';
}

/**
 * For checks, which must never touch the owner's files: PLAYLARK_USER_DATA moves the app's own files, and a
 * headless run without it gets a fresh folder from `makeTemp`, so it never reads the owner's profile or
 * meets the owner's running copy through the single-instance lock.
 */
export function dataPaths(env: NodeJS.ProcessEnv, headless = false, makeTemp?: () => string): DataPaths {
  if (env.PLAYLARK_USER_DATA) return { userData: path.resolve(env.PLAYLARK_USER_DATA), temporary: false };
  if (headless && makeTemp) return { userData: makeTemp(), temporary: true };
  return { userData: null, temporary: false };
}

/** Only our own page may use the bridge or be navigated to. */
export function isAppUrl(url: string | undefined | null): boolean {
  return typeof url === 'string' && url.startsWith('app://playlark/');
}

/** The file under `root` that an app:// request names; null for another host or a path that leaves `root`. */
export function appRequestFile(root: string, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === 'app:' && parsed.host === 'playlark' ? appFile(root, parsed.pathname) : null;
}

/** The only permission the page may have: writing to the clipboard. */
const PERMISSIONS = new Set(['clipboard-sanitized-write']);

/** True when the page at `url` may have `permission`; every other page and permission is refused. */
export function allowPermission(permission: string, url: string | undefined): boolean {
  return PERMISSIONS.has(permission) && (isAppUrl(url) || url === 'app://playlark');
}

/** The file under `root` that an app:// path names, or null when it would leave `root`. */
export function appFile(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.normalize(path.join(root, decoded === '/' ? '/index.html' : decoded));
  return file.startsWith(root + path.sep) ? file : null;
}

/**
 * Removes earlier headless runs' profiles from `tempRoot`: folders named for them that no running copy holds
 * (Chromium keeps a `SingletonLock` in a profile while it runs) and that are over a minute old. A profile
 * can't go when its own run quits, because Chromium still writes to it after the main process's last event.
 * Returns the folders removed; one that can't be removed is left for the next run.
 */
export function removeStaleHeadlessProfiles(tempRoot: string, now = Date.now()): string[] {
  let names: string[];
  try {
    names = readdirSync(tempRoot);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (!name.startsWith(HEADLESS_PREFIX)) continue;
    const folder = path.join(tempRoot, name);
    try {
      const stat = lstatSync(folder);
      if (!stat.isDirectory() || now - stat.mtimeMs < STALE_MS) continue;
      if (readdirSync(folder).includes('SingletonLock')) continue;
      rmSync(folder, { recursive: true, force: true });
      removed.push(folder);
    } catch {
      // Gone already, or not ours to remove: the next run tries again.
      continue;
    }
  }
  return removed;
}
