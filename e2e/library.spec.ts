// The first slice: open the folder the server serves, list its songs, play them in order with a queue.
import { expect, nowPlaying, openApp, runCommand, songs, test, titles, watchErrors } from './fixtures.ts';

const ORDER = [
  'Rain on Tin',
  'Morning Tide',
  'Salt Air',
  'Lantern Walk',
  'Static Bloom',
  'Night Bus',
  'untagged',
];

test.beforeEach(({ seed }) => seed('basic'));

test.describe('Opening a music folder', () => {
  test('the server’s folder opens by itself and its music files are listed', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await expect(page.locator('.pl-status')).toContainText('7 songs');
    await expect(page.locator('.pl-status')).toContainText('Music');
    // notes.txt isn't music, and hidden folders are skipped.
    expect(await titles(page)).not.toContain('secret');
    await expect(page).toHaveTitle(/Playlark/);
    expect(errors).toEqual([]);
  });
});

test.describe('The song list', () => {
  test('lists title, artist, album and time, and the arrow keys move the selection', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    expect(await titles(page)).toEqual(ORDER);
    const tide = songs(page).getByRole('row', { name: /Morning Tide/ });
    await expect(tide).toContainText('Northwind Quartet');
    await expect(tide).toContainText('Harbour Lights');
    await expect(tide).toContainText('0:02');
    await songs(page).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(songs(page).locator('[aria-selected="true"]')).toContainText('Salt Air');
    await page.keyboard.press('End');
    await expect(songs(page).locator('[aria-selected="true"]')).toContainText('untagged');
    expect(errors).toEqual([]);
  });
});

test.describe('Playing songs', () => {
  test('a double-click plays a song, Space pauses it, and the next one follows', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await songs(page)
      .getByRole('row', { name: /Salt Air/ })
      .dblclick();
    const bar = nowPlaying(page);
    await expect(bar).toContainText('Salt Air');
    await expect(bar.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(bar.getByRole('button', { name: 'Play' })).toBeVisible();
    await page.keyboard.press('Space');
    // The song is 2 s long: Lantern Walk follows when it ends.
    await expect(bar).toContainText('Lantern Walk', { timeout: 10_000 });
    await page.keyboard.press('ControlOrMeta+ArrowDown');
    await expect(bar).toContainText('Static Bloom');
    // ⌘↑ goes back a song; ⌘← and ⌘→ move the volume, the way its slider runs.
    await page.keyboard.press('ControlOrMeta+ArrowUp');
    await expect(bar).toContainText('Lantern Walk');
    const volume = bar.getByRole('slider', { name: 'Volume' });
    const before = Number(await volume.inputValue());
    await page.keyboard.press('ControlOrMeta+ArrowLeft');
    await expect.poll(async () => Number(await volume.inputValue())).toBeLessThan(before);
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await expect.poll(async () => Number(await volume.inputValue())).toBeCloseTo(before);
    expect(errors).toEqual([]);
  });

  test('every format plays: MP3, FLAC, M4A, Ogg Vorbis, Opus and WAV', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await expect(songs(page).locator('.pl-unreadable')).toHaveCount(0);
    const bar = nowPlaying(page);
    for (const title of ORDER) {
      await songs(page)
        .getByRole('row', { name: new RegExp(title) })
        .dblclick();
      await expect(bar).toContainText(title);
      await expect(bar.getByRole('button', { name: 'Pause' })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});

test.describe('The queue', () => {
  test('shows what plays next, and a double-click there jumps to it', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await songs(page)
      .getByRole('row', { name: /Morning Tide/ })
      .dblclick();
    await runCommand(page, 'Show Queue');
    const queue = page.getByRole('complementary', { name: 'Queue' });
    await expect(queue).toContainText('Salt Air');
    await expect(queue).toContainText('untagged');
    await queue.getByText('Night Bus').dblclick();
    await expect(nowPlaying(page)).toContainText('Night Bus');
    await page.keyboard.press('ControlOrMeta+Alt+ArrowRight');
    await page.keyboard.press('ControlOrMeta+Alt+KeyU');
    await expect(queue).toBeHidden();
    expect(errors).toEqual([]);
  });
});
