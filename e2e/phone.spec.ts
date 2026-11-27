// The phone app on a NAS (PRD §18.5): the narrow layout, and the app's own files kept for offline starts.
import type { Locator } from '@playwright/test';
import { expect, nowPlaying, openApp, runCommand, songs, test, watchErrors } from './fixtures.ts';

/** The controls inside `box` that stick out past its sides or the screen's. */
function spilled(box: Locator): Promise<string[]> {
  return box.evaluate((root) => {
    const outer = root.getBoundingClientRect();
    const right = Math.min(outer.right, innerWidth);
    return [...root.querySelectorAll('input:not([type="checkbox"]), select, button, h2, h3')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.left < outer.left - 1 || r.right > right + 1 || r.width < 24);
      })
      .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName);
  });
}

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
    await now.getByRole('button', { name: 'Queue', exact: true }).tap();
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

test.describe('The phone layout', () => {
  test('dialogs, album pages and the album grid fit the screen', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await songs(page)
      .getByRole('row', { name: /Salt Air/ })
      .tap();
    await runCommand(page, 'Song Info');
    const info = page.getByRole('dialog');
    await expect(info.getByRole('textbox', { name: 'Title' })).toBeVisible();
    expect(await spilled(info)).toEqual([]);
    await page.keyboard.press('Escape');

    await runCommand(page, 'Settings');
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();
    expect(await spilled(settings)).toEqual([]);
    await page.keyboard.press('Escape');

    // No key hints on a touch screen.
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(page.getByRole('listbox')).toBeVisible();
    await expect(page.getByRole('listbox').locator('kbd:visible')).toHaveCount(0);
    await page.keyboard.press('Escape');

    const tabs = page.getByRole('navigation', { name: 'Tabs' });
    await tabs.getByRole('button', { name: 'Albums' }).tap();
    const grid = page.getByRole('region', { name: 'Albums' });
    const first = await grid.locator('.pl-card-row').first().locator('.pl-card').count();
    expect(first).toBe(2);
    await grid.getByRole('button').first().tap();
    const head = page.locator('.pl-page-head');
    await expect(head.getByRole('button', { name: 'Shuffle' })).toBeVisible();
    expect(await spilled(head)).toEqual([]);
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
