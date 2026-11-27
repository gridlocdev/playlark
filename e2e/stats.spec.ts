// Favourites and play counts in the browser: the heart, the Favourites collection, and keeping them for the next visit.
import { expect, openApp, test, watchErrors } from './fixtures.ts';

test.beforeEach(({ seed }) => {
  seed('basic');
});

test.describe('Favourites and play counts', () => {
  test('a heart puts the song in Favourites, Undo takes it out, and it is kept after a reload', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openApp(page);
    // Empty Favourites: nothing to play, and it says how to fill it.
    await page.getByRole('list', { name: 'Collections' }).getByRole('button', { name: 'Favourites' }).click();
    await expect(page.getByRole('button', { name: 'Play Favourites' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Shuffle Favourites' })).toBeDisabled();
    await expect(page.getByText('Click the heart beside a song')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Digit1');
    const row = page.getByRole('row', { name: /Rain on Tin/ });
    await row.hover();
    const heart = row.getByRole('button', { name: 'Favourite' });
    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');

    const collections = page.getByRole('list', { name: 'Collections' });
    await collections.getByRole('button', { name: 'Favourites' }).click();
    await expect(page.locator('.pl-view-title')).toHaveText('Favourites');
    const list = page.getByRole('grid', { name: 'Favourites' });
    await expect(list.locator('tbody tr')).toHaveCount(1);
    await expect(list.locator('tbody tr')).toContainText('Rain on Tin');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByText('Songs you favourite appear here.')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(list.locator('tbody tr')).toHaveCount(1);

    // Written at most every 2 s, and when the page goes away.
    await page.waitForTimeout(2_500);
    await page.reload();
    await collections.getByRole('button', { name: 'Favourites' }).click();
    await expect(page.getByRole('grid', { name: 'Favourites' }).locator('tbody tr')).toContainText(
      'Rain on Tin',
    );
    await collections.getByRole('button', { name: 'Most Played' }).click();
    await expect(page.getByText('Songs you play appear here.')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
