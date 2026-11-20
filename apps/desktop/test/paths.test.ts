import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allowPermission,
  appFile,
  appRequestFile,
  dataPaths,
  HEADLESS_PREFIX,
  isAppUrl,
  isHeadless,
  removeStaleHeadlessProfiles,
} from '../src/index.ts';

describe('dataPaths', () => {
  it('moves the app files only when a check asks', () => {
    expect(dataPaths({})).toEqual({ userData: null, temporary: false });
    expect(dataPaths({ PLAYLARK_USER_DATA: '/tmp/check' })).toEqual({
      userData: path.resolve('/tmp/check'),
      temporary: false,
    });
  });

  it('gives a headless run a throwaway profile unless a check names one', () => {
    const temp = () => '/tmp/playlark-headless-1';
    expect(dataPaths({}, true, temp)).toEqual({ userData: '/tmp/playlark-headless-1', temporary: true });
    expect(dataPaths({ PLAYLARK_USER_DATA: '/tmp/check' }, true, temp).temporary).toBe(false);
  });
});

describe('isHeadless', () => {
  it('takes the flag or the variable', () => {
    expect(isHeadless(['electron', 'out/main.js', '--headless'], {})).toBe(true);
    expect(isHeadless(['electron', 'out/main.js'], { PLAYLARK_HEADLESS: '1' })).toBe(true);
    expect(isHeadless(['electron', 'out/main.js'], {})).toBe(false);
  });
});

describe('app:// files', () => {
  const root = path.resolve('/app/web');

  it('serves only inside the web build', () => {
    expect(appFile(root, '/')).toBe(path.join(root, 'index.html'));
    expect(appFile(root, '/assets/index.js')).toBe(path.join(root, 'assets/index.js'));
    expect(appFile(root, '/../main.js')).toBeNull();
    expect(appFile(root, '/%2e%2e/main.js')).toBeNull();
    expect(appFile(root, '/%E0%A4%A')).toBeNull();
  });

  it('serves only the playlark host', () => {
    expect(appRequestFile(root, 'app://playlark/index.html')).toBe(path.join(root, 'index.html'));
    expect(appRequestFile(root, 'app://other/index.html')).toBeNull();
    expect(appRequestFile(root, 'app://playlark.evil/index.html')).toBeNull();
    expect(appRequestFile(root, 'not a url')).toBeNull();
  });

  it('gives our page only the clipboard, and other pages nothing', () => {
    expect(allowPermission('clipboard-sanitized-write', 'app://playlark/index.html')).toBe(true);
    expect(allowPermission('clipboard-sanitized-write', 'app://playlark')).toBe(true);
    expect(allowPermission('clipboard-sanitized-write', 'https://example.com/')).toBe(false);
    expect(allowPermission('media', 'app://playlark/index.html')).toBe(false);
    expect(allowPermission('notifications', undefined)).toBe(false);
  });

  it('trusts only our own page', () => {
    expect(isAppUrl('app://playlark/index.html')).toBe(true);
    expect(isAppUrl('app://playlark.evil/index.html')).toBe(false);
    expect(isAppUrl('https://example.com/')).toBe(false);
    expect(isAppUrl(undefined)).toBe(false);
  });
});

describe('removeStaleHeadlessProfiles', () => {
  it('removes old, unlocked headless profiles and nothing else', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'playlark-sweep-'));
    try {
      const make = (name: string, ageMs: number, lock = false) => {
        const folder = path.join(root, name);
        mkdirSync(folder);
        writeFileSync(path.join(folder, 'Preferences'), '{}');
        if (lock) writeFileSync(path.join(folder, 'SingletonLock'), '');
        const when = (Date.now() - ageMs) / 1000;
        utimesSync(folder, when, when);
      };
      make(`${HEADLESS_PREFIX}old`, 3_600_000);
      make(`${HEADLESS_PREFIX}running`, 3_600_000, true);
      make(`${HEADLESS_PREFIX}starting`, 1_000);
      make('someone-else', 3_600_000);
      expect(removeStaleHeadlessProfiles(root).map((f) => path.basename(f))).toEqual([
        `${HEADLESS_PREFIX}old`,
      ]);
      expect(readdirSync(root).sort()).toEqual([
        `${HEADLESS_PREFIX}running`,
        `${HEADLESS_PREFIX}starting`,
        'someone-else',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does nothing when the folder can’t be read', () => {
    expect(removeStaleHeadlessProfiles(path.join(tmpdir(), 'playlark-no-such-folder'))).toEqual([]);
  });
});
