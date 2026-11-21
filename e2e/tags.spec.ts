// Song Info on the NAS: the server writes the tags into the file (PRD §18.2). The desktop app's own save is in
// desktop.spec.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA, expect, openApp, songs, test, watchErrors } from './fixtures.ts';

test.beforeEach(({ seed }) => seed('basic'));

test.describe('Editing tags', () => {
  test('Song Info saves a new title through the server, and Undo puts it back', async ({ page }) => {
    const errors = watchErrors(page);
    const file = path.join(DATA, 'Northwind Quartet/Harbour Lights/02 Salt Air.flac');
    const original = readFileSync(file);
    await openApp(page);
    await songs(page)
      .getByRole('row', { name: /Salt Air/ })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Song Info…' }).click();
    const dialog = page.getByRole('dialog', { name: /Song Info/ });
    const title = dialog.locator('input[name="title"]');
    await expect(title).toHaveValue('Salt Air');
    await expect(dialog).toContainText('FLAC');
    await title.fill('Sea Salt');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(songs(page).getByRole('row', { name: /Sea Salt/ })).toBeVisible();
    expect(readFileSync(file).equals(original)).toBe(false);

    await page.keyboard.press('ControlOrMeta+KeyZ');
    await expect(page.locator('.pl-status')).toContainText('Undo Edit Tags');
    await expect(songs(page).getByRole('row', { name: /Salt Air/ })).toBeVisible();
    await expect(songs(page).getByRole('row', { name: /Sea Salt/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
