// Reduced motion: popups that open from the keyboard take focus at once and close on Esc. A reduced-motion rule
// that only shortens transitions still animates `visibility`, so a popup just shown refuses focus for a moment.
import { expect, openApp, runCommand, songs, test, watchErrors } from './fixtures.ts';

test.use({ reducedMotion: 'reduce' });
test.beforeEach(({ seed }) => seed('basic'));

test.describe('Keyboard focus', () => {
  test('nothing transitions, so a popup opened from the keyboard has focus and Esc closes it', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openApp(page);
    // No element may carry a transition, whatever property it names.
    const moving = await page.evaluate(
      () =>
        [...document.querySelectorAll('*')].filter((el) =>
          getComputedStyle(el)
            .transitionDuration.split(',')
            .some((d) => parseFloat(d) > 0),
        ).length,
    );
    expect(moving).toBe(0);

    // The command menu, then Add to Playlist… from it, then a dialog by its key.
    const list = songs(page);
    await list.locator('tbody tr[role="row"]').first().click();
    await page.keyboard.press('ControlOrMeta+KeyK');
    const palette = page.getByRole('combobox');
    await expect(palette).toBeFocused({ timeout: 100 });
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(list).toBeFocused();

    await runCommand(page, 'Add to Playlist…');
    const add = page.getByRole('dialog', { name: 'Add to playlist' });
    await expect(add.getByRole('combobox')).toBeFocused({ timeout: 100 });
    await page.keyboard.press('Escape');
    await expect(add).toBeHidden();

    await page.keyboard.press('ControlOrMeta+Slash');
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    await expect(shortcuts).toBeVisible();
    await expect(shortcuts.locator(':focus')).toHaveCount(1, { timeout: 100 });
    await page.keyboard.press('Escape');
    await expect(shortcuts).toBeHidden();
    // Esc closed each popup and nothing else: the selection is still there.
    await expect(list.locator('tbody tr[aria-selected="true"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});
