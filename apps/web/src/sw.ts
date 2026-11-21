/**
 * The phone app's service worker (PRD §18.5). It keeps the app's own files when it installs, and answers from
 * them only while the device is offline, so the app still opens; online, every request goes to the server as
 * usual. Registered only by a page served from a Playlark server.
 */
import { SHELL_CACHE_PREFIX, answersFromShell, shellCacheName } from './shell.ts';

/** The build's file list, written in by the build (vite.config.ts). */
declare const __PLAYLARK_SHELL__: readonly string[];

interface WaitEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}
interface ShellFetchEvent extends WaitEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
interface ShellWorker {
  readonly registration: { readonly scope: string };
  readonly navigator: { readonly onLine: boolean };
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (e: WaitEvent) => void): void;
  addEventListener(type: 'fetch', listener: (e: ShellFetchEvent) => void): void;
}

const worker = self as unknown as ShellWorker;
const files = __PLAYLARK_SHELL__;
const name = shellCacheName(files);

worker.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(name)
      .then((cache) => cache.addAll(files))
      .then(() => worker.skipWaiting()),
  );
});

worker.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith(SHELL_CACHE_PREFIX) && k !== name).map((k) => caches.delete(k)),
        ),
      )
      .then(() => worker.clients.claim()),
  );
});

worker.addEventListener('fetch', (e) => {
  const { request } = e;
  const scope = new URL(worker.registration.scope);
  if (worker.navigator.onLine || !answersFromShell(new URL(request.url), scope, request.method)) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(name);
      const hit =
        (await cache.match(request, { ignoreSearch: true })) ??
        (request.mode === 'navigate' ? await cache.match('./') : undefined);
      return hit ?? Response.error();
    })(),
  );
});
