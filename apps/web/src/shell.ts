/**
 * The app's own files, kept by the service worker so the phone app starts offline (PRD §18.5). Music, covers
 * and the API never go in it: they always come from the server.
 */
export const SHELL_CACHE_PREFIX = 'playlark-shell-';

/** The files to keep, relative to the app's folder, from the build's file names. */
export function shellFiles(built: readonly string[]): string[] {
  const keep = built.filter((f) => !f.endsWith('.map') && f !== 'sw.js' && !f.startsWith('api/'));
  return ['./', ...[...new Set(keep)].sort()];
}

/** One cache per build: the name changes whenever a file does, so a new build replaces the old cache. */
export function shellCacheName(files: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const ch of files.join('\n')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `${SHELL_CACHE_PREFIX}${h.toString(16).padStart(8, '0')}`;
}

/** Whether the service worker may answer `url` from the kept files: a GET for the app, not for the API. */
export function answersFromShell(url: URL, scope: URL, method: string): boolean {
  if (method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname))
    return false;
  return !url.pathname.slice(scope.pathname.length).startsWith('api/');
}
