// Desktop smoke test: the built Electron app starts headless (no window, Dock icon, sound or system dialog) on a
// throwaway profile, lists the fixture folder and plays it. `just e2e-desktop` builds it first. The throwaway
// profile matters: the app must never read the owner's settings, window state or music folder.
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication } from '@playwright/test';
import {
  DATA,
  expect,
  nowPlaying,
  runCommand,
  songs,
  test,
  titles,
  waitForApp,
  watchErrors,
} from './fixtures.ts';

const DESKTOP = fileURLToPath(new URL('../apps/desktop', import.meta.url));

/** True while the process is still running. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Closes the app and checks that its main process is gone (Electron's helpers exit with it). */
async function closeApp(app: ElectronApplication): Promise<void> {
  const pid = app.process().pid!;
  await app.close();
  await expect.poll(() => alive(pid), { message: 'no Electron process is left running' }).toBe(false);
}

const headlessLog = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { playlarkHeadless?: { dialogs: string[] } }).playlarkHeadless?.dialogs);

test.beforeEach(({ seed }) => seed('basic'));

test.describe('Desktop app', () => {
  test('starts headless, lists the folder, plays a song and grants nothing but the clipboard', async () => {
    // realpath: macOS's temp folder is behind a symlink, and the app may report the real path.
    const temp = realpathSync(mkdtempSync(path.join(tmpdir(), 'playlark-e2e-')));
    const profile = path.join(temp, 'profile');
    const app = await electron.launch({
      cwd: DESKTOP,
      // The main script by name (the built one package.json points at), so nothing else is read as an argument.
      args: ['out/main.js'],
      env: { ...process.env, PLAYLARK_HEADLESS: '1', PLAYLARK_USER_DATA: profile, PLAYLARK_MUSIC: DATA },
    });
    try {
      expect(await app.evaluate(({ app }) => app.getPath('userData')), 'the throwaway profile').toBe(profile);
      const window = await app.firstWindow();
      const errors = watchErrors(window);
      await waitForApp(window);
      expect(await titles(window)).toHaveLength(7);
      await songs(window)
        .getByRole('row', { name: /Morning Tide/ })
        .dblclick();
      const bar = nowPlaying(window);
      await expect(bar).toContainText('Morning Tide');
      await expect(bar.getByRole('button', { name: 'Pause' })).toBeVisible();
      await expect(bar, 'the next song follows').toContainText('Salt Air', { timeout: 10_000 });
      // Open Music Folder asks the system for a folder: in a headless run the picker is recorded, not shown.
      await runCommand(window, 'Open Music Folder');
      await expect.poll(() => headlessLog(app)).toEqual(['Open Music Folder']);
      const permission = (name: string) =>
        window.evaluate(
          async (n) => (await navigator.permissions.query({ name: n as PermissionName })).state,
          name,
        );
      expect(await permission('clipboard-write')).toBe('granted');
      expect(await permission('geolocation')).toBe('denied');
      expect(await permission('notifications')).toBe('denied');
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.webContents.isAudioMuted(),
        ),
        'a headless run makes no sound',
      ).toBe(true);
      expect(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible())),
        'no window shows on the screen',
      ).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await closeApp(app);
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('keeps the index in its data folder and shows a song’s own cover', async ({ seed }) => {
    seed('covers');
    const temp = realpathSync(mkdtempSync(path.join(tmpdir(), 'playlark-e2e-')));
    const profile = path.join(temp, 'profile');
    const app = await electron.launch({
      cwd: DESKTOP,
      args: ['out/main.js'],
      env: { ...process.env, PLAYLARK_HEADLESS: '1', PLAYLARK_USER_DATA: profile, PLAYLARK_MUSIC: DATA },
    });
    try {
      const window = await app.firstWindow();
      const errors = watchErrors(window);
      await waitForApp(window);
      await expect
        .poll(() => existsSync(path.join(profile, 'library.json')), 'the index is saved')
        .toBe(true);
      expect(readdirSync(path.join(profile, 'covers'))).toHaveLength(1);
      await songs(window)
        .getByRole('row', { name: /Framed/ })
        .dblclick();
      const cover = nowPlaying(window).locator('.pl-now-cover img');
      await expect(cover).toHaveAttribute('src', /^app:\/\/playlark\/cover\/[0-9a-f]{64}$/);
      await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(8);
      expect(errors).toEqual([]);
    } finally {
      await closeApp(app);
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('--headless alone runs on a throwaway profile', async () => {
    const temp = realpathSync(mkdtempSync(path.join(tmpdir(), 'playlark-e2e-')));
    const { PLAYLARK_HEADLESS: _headless, PLAYLARK_USER_DATA: _userData, ...inherited } = process.env;
    const app = await electron.launch({
      cwd: DESKTOP,
      args: ['out/main.js', '--headless'],
      env: { ...inherited, TMPDIR: temp, PLAYLARK_MUSIC: DATA },
    });
    try {
      const profile = realpathSync(await app.evaluate(({ app }) => app.getPath('userData')));
      expect(path.dirname(profile), 'a profile made for this run').toBe(temp);
      expect(path.basename(profile)).toMatch(/^playlark-headless-/);
      const window = await app.firstWindow();
      const errors = watchErrors(window);
      await waitForApp(window);
      expect(errors).toEqual([]);
    } finally {
      await closeApp(app);
      rmSync(temp, { recursive: true, force: true });
    }
  });

  for (const [kind, crash] of [
    ['an uncaught exception', 'throw'],
    ['an unhandled rejection', 'reject'],
  ] as const) {
    test(`${kind} in a headless run exits instead of showing a dialog`, async () => {
      const temp = realpathSync(mkdtempSync(path.join(tmpdir(), 'playlark-e2e-')));
      const app = await electron.launch({
        cwd: DESKTOP,
        args: ['out/main.js', '--headless'],
        env: { ...process.env, PLAYLARK_USER_DATA: path.join(temp, 'profile'), PLAYLARK_MUSIC: DATA },
      });
      const child = app.process();
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      try {
        await waitForApp(await app.firstWindow());
        const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
        await app.evaluate((_electron, how) => {
          setTimeout(() => {
            const error = new Error('a deliberate error from the check');
            if (how === 'throw') throw error;
            void Promise.reject(error);
          });
        }, crash);
        expect(await exited, 'the app exits with an error code').toBe(1);
        expect(stderr).toContain('a deliberate error from the check');
      } finally {
        if (child.exitCode === null) child.kill();
        rmSync(temp, { recursive: true, force: true });
      }
      await expect
        .poll(() => alive(child.pid!), { message: 'no Electron process is left running' })
        .toBe(false);
    });
  }
});
