// Cover art, files that can't be read, and the index kept between visits.
import { expect, nowPlaying, openApp, songs, test, watchErrors } from './fixtures.ts';

/** A cover the server stored, or one the page read itself before the server's scan got to it. */
const COVER_URL = /^(\.\/api\/covers\/[0-9a-f]{64}|blob:.*)$/;

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
    await expect(cover).toHaveAttribute('src', COVER_URL);
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
    await expect(cover).toHaveAttribute('src', COVER_URL);
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
  test('the server keeps the scan, and the page shows it at once next time', async ({ page, seed }) => {
    seed('basic');
    const errors = watchErrors(page);
    await openApp(page);
    const kept = () =>
      page.evaluate(async () => {
        const r = await fetch('./api/library');
        return r.status === 200 ? ((await r.json()) as { songs: [] }).songs.length : 0;
      });
    await expect.poll(kept).toBe(7);
    await page.reload();
    await expect(songs(page).locator('tbody tr')).toHaveCount(7);
    expect(errors).toEqual([]);
  });
});
