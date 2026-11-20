// Cover art, files that can't be read, and the index kept between visits.
import { expect, nowPlaying, openApp, songs, test, watchErrors } from './fixtures.ts';

test.describe('Cover art', () => {
  test('shows the folder’s image, or the song’s own picture, beside the playing song', async ({
    page,
    seed,
  }) => {
    seed('basic');
    const errors = watchErrors(page);
    await openApp(page);
    const cover = nowPlaying(page).locator('.pl-now-cover img');
    await songs(page)
      .getByRole('row', { name: /Static Bloom/ })
      .dblclick();
    await expect(cover).toHaveAttribute('src', /^blob:/);
    expect(await cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(8);
    await songs(page)
      .getByRole('row', { name: /Morning Tide/ })
      .dblclick();
    await expect(nowPlaying(page)).toContainText('Morning Tide');
    await expect(cover).toHaveCount(0);

    seed('covers');
    await openApp(page);
    await songs(page)
      .getByRole('row', { name: /Framed/ })
      .dblclick();
    await expect(cover).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(8);
    expect(errors).toEqual([]);
  });
});

test.describe('Files that can’t be read', () => {
  test('stay listed, and the notice opens a list of them with the reason', async ({ page, seed }) => {
    seed('covers');
    const errors = watchErrors(page);
    await openApp(page);
    await expect(songs(page).locator('.pl-unreadable')).toHaveCount(1);
    const status = page.locator('.pl-status');
    await expect(status).toContainText('1 file couldn’t be read.');
    await status.getByRole('button', { name: 'Show' }).click();
    const dialog = page.getByRole('dialog', { name: 'Files That Couldn’t Be Read' });
    await expect(dialog).toContainText('Gallery/broken.flac');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe('Remembering the library', () => {
  test('the scan is kept in the browser and shown at once next time', async ({ page, seed }) => {
    seed('basic');
    const errors = watchErrors(page);
    await openApp(page);
    const saved = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const open = indexedDB.open('playlark');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const get = open.result.transaction('index').objectStore('index').get('Music');
              get.onerror = () => reject(get.error);
              get.onsuccess = () =>
                resolve(
                  typeof get.result === 'string' ? (JSON.parse(get.result) as { songs: [] }).songs.length : 0,
                );
            };
          }),
      );
    await expect.poll(saved).toBe(7);
    await page.reload();
    await expect(songs(page).locator('tbody tr')).toHaveCount(7);
    expect(errors).toEqual([]);
  });
});
