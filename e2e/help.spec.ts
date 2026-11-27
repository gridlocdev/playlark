import { commandMenu, expect, openApp, test, watchErrors } from './fixtures.ts';

test.describe('Keyboard shortcuts', () => {
  test('before anything is typed, ⌘K lists the commands that can run now first', async ({ page, seed }) => {
    seed('basic');
    const errors = watchErrors(page);
    await openApp(page);
    await page.keyboard.press('ControlOrMeta+KeyK');
    const options = page.getByRole('listbox').getByRole('option');
    await expect(options.first()).toBeVisible();
    const disabled = await options.evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-disabled') === 'true'),
    );
    expect(disabled.indexOf(true)).toBeGreaterThan(0);
    expect(disabled.slice(disabled.indexOf(true))).not.toContain(false);
    expect(errors).toEqual([]);
  });

  test('Press a Shortcut names the command a key runs without running it, and Esc gives the keys back', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await page.keyboard.press('ControlOrMeta+Slash');
    const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Press a Shortcut…' }).click();
    const status = dialog.getByRole('status');
    await expect(status).toContainText('Press a shortcut');
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(status).toContainText('Command Menu');
    await expect(commandMenu(page)).toBeHidden();
    await page.keyboard.press('ControlOrMeta+Shift+KeyJ');
    await expect(status).toHaveText('No command uses that key.');

    // Stop leaves the mode and keeps the window.
    await dialog.getByRole('button', { name: 'Stop' }).click();
    await expect(status).toBeHidden();
    await expect(dialog).toBeVisible();

    // Esc always leaves the mode, and then closes the window as it always does.
    await dialog.getByRole('button', { name: 'Press a Shortcut…' }).click();
    await expect(status).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(commandMenu(page)).toBeVisible();
    expect(errors).toEqual([]);
  });
});
