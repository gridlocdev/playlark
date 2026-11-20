// Song Info in the browser. Saving tags runs in the desktop app (desktop.spec.ts); a folder that can't be
// written shows the tags read-only.
import { expect, openApp, songs, test, watchErrors } from './fixtures.ts';

test.beforeEach(({ seed }) => seed('basic'));

test.describe('Editing tags', () => {
  test('Song Info shows a song’s tags and file facts, read-only where the folder can’t be written', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await songs(page)
      .getByRole('row', { name: /Lantern Walk/ })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Song Info…' }).click();
    const dialog = page.getByRole('dialog', { name: /Song Info/ });
    await expect(dialog.locator('input[name="title"]')).toHaveValue('Lantern Walk');
    await expect(dialog.locator('input[name="title"]')).toBeDisabled();
    await expect(dialog).toContainText('Edit tags in the desktop app or through the NAS server.');
    await expect(dialog).toContainText('M4A (AAC)');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
  });
});
