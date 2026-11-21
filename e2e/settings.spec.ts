// The Settings window in the browser: each change takes effect at once and is kept for the next visit.
import { expect, openApp, runCommand, test, watchErrors } from './fixtures.ts';

test.beforeEach(({ seed }) => {
  seed('basic');
});

test.describe('Settings', () => {
  test('Dark appearance and a crossfade are applied at once and kept after a reload', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await runCommand(page, 'Settings');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByLabel('Appearance').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const background = () => page.evaluate(() => getComputedStyle(document.body).colorScheme);
    expect(await background()).toBe('dark');
    await dialog.getByLabel('Crossfade').selectOption('4');
    await expect(dialog.getByLabel('Pre-amp')).toBeEnabled();
    await dialog.getByLabel('ReplayGain').selectOption('off');
    await expect(dialog.getByLabel('Pre-amp'), 'no pre-amp without ReplayGain').toBeDisabled();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('ControlOrMeta+,');
    await expect(dialog.getByLabel('Crossfade')).toHaveValue('4');
    await expect(dialog.getByLabel('ReplayGain')).toHaveValue('off');
    await dialog.getByLabel('Appearance').selectOption('system');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
    await page.keyboard.press('ControlOrMeta+,');
    await expect(dialog, '⌘, again closes it').toBeHidden();
    expect(errors).toEqual([]);
  });
});
