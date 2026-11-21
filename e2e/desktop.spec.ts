// Desktop smoke test: the built Electron app starts headless (no window, Dock icon, sound or system dialog) on a
// throwaway profile, lists the fixture folder and plays it. `just e2e-desktop` builds it first. The throwaway
// profile matters: the app must never read the owner's settings, window state or music folder.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication } from '@playwright/test';
import {
  DATA,
  expect,
  nowPlaying,
  runCommand,
  seedMix,
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
      // Show in Finder from the song's right-click menu: a headless run records the file instead of opening Finder.
      await songs(window)
        .getByRole('row', { name: /Morning Tide/ })
        .click({ button: 'right' });
      await window
        .getByRole('menu')
        .getByRole('menuitem', { name: /^Show in (Finder|File Explorer|File Manager)$/ })
        .click();
      await expect
        .poll(() =>
          app.evaluate(
            () => (globalThis as { playlarkHeadless?: { revealed: string[] } }).playlarkHeadless?.revealed,
          ),
        )
        .toEqual([path.join(realpathSync(DATA), 'Northwind Quartet/Harbour Lights/01 Morning Tide.mp3')]);
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
      // One index per folder, in `libraries/<key>/`.
      const library = () => {
        const all = path.join(profile, 'libraries');
        return existsSync(all) ? readdirSync(all).map((key) => path.join(all, key)) : [];
      };
      await expect
        .poll(() => library().some((dir) => existsSync(path.join(dir, 'library.json'))), 'the index is saved')
        .toBe(true);
      expect(readdirSync(path.join(library()[0]!, 'covers'))).toHaveLength(1);
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

test.describe('Editing playlists', () => {
  test('makes, fills, renames and deletes a playlist in the folder, with Undo', async () => {
    seedMix();
    const temp = realpathSync(mkdtempSync(path.join(tmpdir(), 'playlark-e2e-')));
    const profile = path.join(temp, 'profile');
    const app = await electron.launch({
      cwd: DESKTOP,
      args: ['out/main.js'],
      env: { ...process.env, PLAYLARK_HEADLESS: '1', PLAYLARK_USER_DATA: profile, PLAYLARK_MUSIC: DATA },
    });
    const file = (name: string) => path.join(DATA, 'Playlists', name);
    const entries = (name: string) =>
      readFileSync(file(name), 'utf8')
        .split('\n')
        .filter((l) => l && !l.startsWith('#'));
    try {
      const window = await app.firstWindow();
      const errors = watchErrors(window);
      await waitForApp(window);
      const sidebar = window.getByRole('list', { name: 'Playlists' });
      await expect(sidebar.getByRole('button')).toHaveText(['Mix']);

      // ⌘N with a song selected: the new playlist holds it, and its name field is ready.
      await songs(window)
        .getByRole('row', { name: /Salt Air/ })
        .click();
      await window.keyboard.press('ControlOrMeta+KeyN');
      const name = sidebar.getByRole('textbox');
      await expect(name).toBeFocused();
      await window.keyboard.type('Road Trip');
      await window.keyboard.press('Enter');
      await expect(sidebar.getByRole('button')).toHaveText(['Mix', 'Road Trip']);
      await expect.poll(() => existsSync(file('Road Trip.m3u8'))).toBe(true);
      expect(entries('Road Trip.m3u8')).toEqual(['../Northwind Quartet/Harbour Lights/02 Salt Air.flac']);

      // Drag a song onto the playlist in the sidebar.
      await window.getByRole('button', { name: 'Songs' }).click();
      await songs(window)
        .getByRole('row', { name: /Night Bus/ })
        .dragTo(sidebar.getByRole('button', { name: 'Road Trip' }));
      await expect(window.locator('.pl-status')).toContainText('Added 1 song to Road Trip.');
      await expect
        .poll(() => entries('Road Trip.m3u8'))
        .toEqual([
          '../Northwind Quartet/Harbour Lights/02 Salt Air.flac',
          '../Paper Kites Club/Small Hours/2-01 Night Bus.opus',
        ]);

      // Delete in the playlist takes the selected song out; ⌘Z puts it back.
      await sidebar.getByRole('button', { name: 'Road Trip' }).click();
      const list = window.getByRole('grid', { name: 'Road Trip' });
      await list.getByRole('row', { name: /Salt Air/ }).click();
      await window.keyboard.press('Delete');
      await expect(list.locator('tbody tr td.pl-col-title')).toHaveText(['Night Bus']);
      await expect.poll(() => entries('Road Trip.m3u8')).toHaveLength(1);
      await window.keyboard.press('ControlOrMeta+KeyZ');
      await expect(list.locator('tbody tr td.pl-col-title')).toHaveText(['Salt Air', 'Night Bus']);
      await expect.poll(() => entries('Road Trip.m3u8')).toHaveLength(2);

      // Delete Playlist from its right-click menu: to the trash in the data folder, and Undo brings it back.
      await sidebar.getByRole('button', { name: 'Road Trip' }).click({ button: 'right' });
      await window
        .getByRole('menu', { name: 'Playlist' })
        .getByRole('menuitem', { name: 'Delete Playlist' })
        .click();
      await expect(window.locator('.pl-status')).toContainText('Deleted Road Trip.');
      await expect.poll(() => existsSync(file('Road Trip.m3u8'))).toBe(false);
      const trash = readdirSync(path.join(profile, 'trash'));
      expect(existsSync(path.join(profile, 'trash', trash[0]!, 'Playlists', 'Road Trip.m3u8'))).toBe(true);
      await window.locator('.pl-status').getByRole('button', { name: 'Undo' }).click();
      await expect.poll(() => existsSync(file('Road Trip.m3u8'))).toBe(true);
      await expect(sidebar.getByRole('button')).toHaveText(['Mix', 'Road Trip']);
      expect(errors).toEqual([]);
    } finally {
      await closeApp(app);
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

test.describe('Editing tags', () => {
  test('Song Info saves a new title into the file, keeps the original in the trash, and Undo puts it back', async () => {
    const temp = realpathSync(mkdtempSync(path.join(tmpdir(), 'playlark-e2e-')));
    const profile = path.join(temp, 'profile');
    const app = await electron.launch({
      cwd: DESKTOP,
      args: ['out/main.js'],
      env: { ...process.env, PLAYLARK_HEADLESS: '1', PLAYLARK_USER_DATA: profile, PLAYLARK_MUSIC: DATA },
    });
    const file = path.join(DATA, 'Northwind Quartet/Harbour Lights/02 Salt Air.flac');
    const original = readFileSync(file);
    try {
      const window = await app.firstWindow();
      const errors = watchErrors(window);
      await waitForApp(window);
      await songs(window)
        .getByRole('row', { name: /Salt Air/ })
        .click();
      await window.keyboard.press('ControlOrMeta+KeyI');
      const dialog = window.getByRole('dialog', { name: /Song Info/ });
      const title = dialog.locator('input[name="title"]');
      await expect(title).toHaveValue('Salt Air');
      await expect(dialog).toContainText('FLAC');
      await title.fill('Sea Salt');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();
      await expect(songs(window).getByRole('row', { name: /Sea Salt/ })).toBeVisible();
      expect(readFileSync(file).equals(original)).toBe(false);
      const day = readdirSync(path.join(profile, 'trash'))[0]!;
      const trashed = path.join(profile, 'trash', day, 'Northwind Quartet/Harbour Lights/02 Salt Air.flac');
      expect(readFileSync(trashed).equals(original)).toBe(true);

      await window.keyboard.press('ControlOrMeta+KeyZ');
      await expect(window.locator('.pl-status')).toContainText('Undo Edit Tags');
      await expect(songs(window).getByRole('row', { name: /Salt Air/ })).toBeVisible();
      await expect(songs(window).getByRole('row', { name: /Sea Salt/ })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await closeApp(app);
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

test.describe('Opening a music folder', () => {
  /** Starts the app with no folder given, so it asks; PLAYLARK_USUAL_MUSIC stands in for ~/Music. */
  async function launch(profile: string, usual?: string) {
    const { PLAYLARK_MUSIC: _music, ...inherited } = process.env;
    return electron.launch({
      cwd: DESKTOP,
      args: ['out/main.js'],
      env: {
        ...inherited,
        PLAYLARK_HEADLESS: '1',
        PLAYLARK_USER_DATA: profile,
        ...(usual ? { PLAYLARK_USUAL_MUSIC: usual } : {}),
      },
    });
  }

  test('asks at first start, opens the Music folder, and keeps the settings in settings.json', async () => {
    const temp = realpathSync(mkdtempSync(path.join(tmpdir(), 'playlark-e2e-')));
    const profile = path.join(temp, 'profile');
    const app = await launch(profile, DATA);
    try {
      const window = await app.firstWindow();
      const errors = watchErrors(window);
      const question = window.getByRole('dialog', { name: 'Choose Your Music' });
      await expect(question).toBeVisible();
      // Choose Folder… shows the system's picker: in a headless run it is recorded and cancelled.
      await question.getByRole('button', { name: 'Choose Folder…' }).click();
      await expect.poll(() => headlessLog(app)).toEqual(['Open Music Folder']);
      await expect(question).toBeVisible();
      await question.getByRole('button', { name: 'Use Music Folder' }).click();
      await expect(question).toBeHidden();
      await expect.poll(() => titles(window)).toHaveLength(7);
      expect(JSON.parse(readFileSync(path.join(profile, 'folder.json'), 'utf8'))).toEqual({ folder: DATA });

      await runCommand(window, 'Settings');
      await window.getByRole('dialog', { name: 'Settings' }).getByLabel('Appearance').selectOption('dark');
      await expect
        .poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'menus and title bar follow')
        .toBe('dark');
      await expect
        .poll(() => {
          const file = path.join(profile, 'settings.json');
          return existsSync(file) ? readFileSync(file, 'utf8') : '';
        })
        .toContain('"appearance": "dark"');
      expect(errors).toEqual([]);
    } finally {
      await closeApp(app);
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('names the remembered folder when it is gone, and a headless run has no Music folder of its own', async () => {
    const temp = realpathSync(mkdtempSync(path.join(tmpdir(), 'playlark-e2e-')));
    const profile = path.join(temp, 'profile');
    mkdirSync(profile, { recursive: true });
    const gone = path.join(temp, 'Unplugged Drive', 'Music');
    writeFileSync(path.join(profile, 'folder.json'), JSON.stringify({ folder: gone }));
    const app = await launch(profile);
    try {
      const window = await app.firstWindow();
      const errors = watchErrors(window);
      const question = window.getByRole('dialog', { name: 'Music Folder Not Found' });
      await expect(question).toContainText(gone);
      await question.getByRole('button', { name: 'Use Music Folder' }).click();
      await expect.poll(() => headlessLog(app)).toEqual(['Use Music Folder']);
      await expect(window.getByText('There is no Music folder.').first()).toBeVisible();
      await expect(question).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await closeApp(app);
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
