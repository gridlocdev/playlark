// The phone app on a NAS (PRD §18.5): the narrow layout, and the app's own files kept for offline starts.
import { expect, nowPlaying, openApp, songs, test, watchErrors } from './fixtures.ts';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.beforeEach(({ seed }) => seed('basic'));

test.describe('The phone layout', () => {
  test('tabs at the bottom, a tap plays, and the mini bar opens a full-screen player', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    const tabs = page.getByRole('navigation', { name: 'Tabs' });
    await expect(tabs).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Library' })).toBeHidden();
    await expect(tabs.getByRole('button', { name: 'Songs' })).toHaveAttribute('aria-current', 'page');

    await songs(page)
      .getByRole('row', { name: /Salt Air/ })
      .tap();
    const now = nowPlaying(page);
    await expect(now).toContainText('Salt Air');
    await expect(now.getByRole('slider', { name: 'Position' })).toBeHidden();
    await page.screenshot({ path: '.e2e-results/phone/songs.png' });

    await now.getByRole('button', { name: 'Open Player' }).tap();
    await expect(now.getByRole('slider', { name: 'Position' })).toBeVisible();
    await expect(now.getByRole('button', { name: 'Shuffle' })).toBeVisible();
    await page.screenshot({ path: '.e2e-results/phone/player.png' });
    await now.getByRole('button', { name: 'Queue' }).tap();
    const queue = page.getByRole('complementary', { name: 'Queue' });
    await expect(queue).toBeVisible();
    await queue.getByRole('button', { name: 'Close Queue' }).tap();
    await expect(queue).toBeHidden();
    await now.getByRole('button', { name: 'Close Player' }).tap();
    await expect(now.getByRole('slider', { name: 'Position' })).toBeHidden();

    await tabs.getByRole('button', { name: 'Albums' }).tap();
    await expect(tabs.getByRole('button', { name: 'Albums' })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('button', { name: 'Playlists' }).tap();
    const lists = page.getByRole('navigation', { name: 'Playlists' });
    await expect(lists.getByRole('button', { name: 'Favourites' })).toBeVisible();
    await page.screenshot({ path: '.e2e-results/phone/playlists.png' });
    await tabs.getByRole('button', { name: 'Search' }).tap();
    await expect(page.getByRole('searchbox', { name: 'Search the library' })).toBeFocused();
    expect(errors).toEqual([]);
  });
});

test.describe('Opening offline', () => {
  test('the app keeps its own files, so it still opens with no network', async ({ page, context }) => {
    await openApp(page);
    await expect
      .poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active))
      .toBe(true);
    const kept = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names.find((n) => n.startsWith('playlark-shell-'))!);
      return (await cache.keys()).map((r) => new URL(r.url).pathname);
    });
    expect(kept.some((p) => p.includes('/api/'))).toBe(false);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeVisible();
    await context.setOffline(false);
  });
});
