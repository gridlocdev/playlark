// Browsing and search (PRD §6): albums, artists, folders, back and forward, search, and long lists.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { DATA, expect, nowPlaying, openApp, songs, test, watchErrors } from './fixtures.ts';

test.beforeEach(({ seed }) => seed('basic'));

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Library' });

test.describe('Albums', () => {
  test('a grid of covers opens an album page with its songs by disc', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await sidebar(page).getByRole('button', { name: 'Albums' }).click();
    const grid = page.getByRole('region', { name: 'Albums' });
    await expect(grid.getByRole('button', { name: /Harbour Lights/ })).toBeVisible();
    await grid.getByRole('button', { name: /Small Hours/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Small Hours' })).toBeVisible();
    await expect(page.locator('.pl-page-facts')).toContainText('2 songs');
    // The folder's cover image shows on the page.
    await expect(page.locator('.pl-page-head .pl-cover img')).toBeVisible();
    const list = page.getByRole('grid', { name: 'Small Hours' });
    await expect(list.locator('.pl-disc')).toHaveText(['Disc 1', 'Disc 2']);
    await page.getByRole('button', { name: 'Play Small Hours' }).click();
    await expect(nowPlaying(page)).toContainText('Static Bloom');
    await expect(
      list.getByRole('row', { name: /Static Bloom/ }).getByRole('img', { name: 'Playing' }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Artists', () => {
  test('each album artist, with a page of their albums', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await page.keyboard.press('ControlOrMeta+Digit3');
    const list = page.getByRole('list', { name: 'Artists' });
    await expect(list.getByRole('button', { name: /Northwind Quartet/ })).toContainText('1 album');
    await list.getByRole('button', { name: /Northwind Quartet/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Northwind Quartet' })).toBeVisible();
    await page
      .getByRole('list', { name: 'Albums' })
      .getByRole('button', { name: /Harbour Lights/ })
      .click();
    await expect(page.getByRole('heading', { level: 2, name: 'Harbour Lights' })).toBeVisible();
    await page.getByRole('button', { name: 'Northwind Quartet' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Northwind Quartet' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Folders', () => {
  test('subfolders, then songs; Play plays everything under the folder', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await sidebar(page).getByRole('button', { name: 'Folders' }).click();
    const folders = page.getByRole('list', { name: 'Folders' });
    await folders.getByRole('button', { name: 'Northwind Quartet' }).click();
    await folders.getByRole('button', { name: 'Harbour Lights' }).click();
    await expect(page.getByRole('grid', { name: 'Harbour Lights' }).locator('tbody tr')).toHaveCount(3);
    await page
      .getByRole('navigation', { name: 'Folder path' })
      .getByRole('button', { name: 'Music' })
      .click();
    await folders.getByRole('button', { name: 'Paper Kites Club' }).click();
    await page.getByRole('button', { name: 'Play Paper Kites Club' }).click();
    await expect(nowPlaying(page)).toContainText('Static Bloom');
    expect(errors).toEqual([]);
  });
});

test.describe('Back and forward', () => {
  test('the toolbar buttons and ⌘[ ⌘] walk through the views opened', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    const back = page.getByRole('button', { name: 'Back' });
    await expect(back).toBeDisabled();
    await page.keyboard.press('ControlOrMeta+Digit2');
    await page
      .getByRole('region', { name: 'Albums' })
      .getByRole('button', { name: /Harbour Lights/ })
      .click();
    await back.click();
    await expect(page.locator('.pl-view-title')).toHaveText('Albums');
    await page.keyboard.press('ControlOrMeta+BracketLeft');
    await expect(page.locator('.pl-view-title')).toHaveText('Songs');
    await page.keyboard.press('ControlOrMeta+BracketRight');
    await page.keyboard.press('ControlOrMeta+BracketRight');
    await expect(page.locator('.pl-view-title')).toHaveText('Harbour Lights');
    await page.keyboard.press('ControlOrMeta+Alt+KeyS');
    await expect(sidebar(page)).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe('Search', () => {
  test('⌘F, then typing finds artists, albums and songs; Escape goes back', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await page.keyboard.press('ControlOrMeta+KeyF');
    const field = page.getByRole('searchbox', { name: 'Search the library' });
    await expect(field).toBeFocused();
    await page.keyboard.type('northwind');
    await expect(page.locator('.pl-view-title')).toHaveText('Search');
    await expect(page.getByRole('region', { name: 'Artists' })).toContainText('Northwind Quartet');
    await expect(page.getByRole('region', { name: 'Albums' })).toContainText('Harbour Lights');
    await expect(songs(page).locator('tbody tr')).toHaveCount(3);
    // Every word must match: the artist alone doesn't, the album does.
    await page.keyboard.type(' har');
    await expect(page.getByRole('region', { name: 'Artists' })).toBeHidden();
    await expect(page.getByRole('region', { name: 'Albums' })).toContainText('Harbour Lights');
    // Accents and case don't matter, and each word matches the start of a word.
    await field.fill('SÁLT');
    await expect(songs(page).locator('tbody tr')).toHaveCount(1);
    await field.fill('alt');
    await expect(page.getByText('Nothing matches “alt”.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('');
    await expect(page.locator('.pl-view-title')).toHaveText('Songs');
    expect(errors).toEqual([]);
  });
});

test.describe('Selecting songs', () => {
  test('Shift extends the selection, ⌘A selects all, Return plays the selected songs', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await songs(page)
      .getByRole('row', { name: /Morning Tide/ })
      .click();
    await page.keyboard.press('Shift+ArrowDown');
    await expect(songs(page).locator('[aria-selected="true"]')).toHaveCount(2);
    await page.keyboard.press('Enter');
    await expect(nowPlaying(page)).toContainText('Morning Tide');
    await page.keyboard.press('ControlOrMeta+Alt+KeyU');
    const queue = page.getByRole('complementary', { name: 'Queue' });
    await expect(queue).toContainText('Salt Air');
    await expect(queue).not.toContainText('Lantern Walk');
    await songs(page).focus();
    await page.keyboard.press('ControlOrMeta+KeyA');
    await expect(songs(page).locator('[aria-selected="true"]')).toHaveCount(7);
    expect(errors).toEqual([]);
  });
});

test.describe('Long lists', () => {
  test('only the rows in view are drawn, and End reaches the last song', async ({ page }) => {
    const errors = watchErrors(page);
    const many = join(DATA, 'Many');
    mkdirSync(many);
    for (let i = 1; i <= 1500; i++)
      copyFileSync(join(DATA, 'Loose/untagged.mp3'), join(many, `song ${String(i).padStart(4, '0')}.mp3`));
    await openApp(page);
    await expect(page.locator('.pl-status')).toContainText('1,507 songs', { timeout: 30_000 });
    await expect(songs(page)).toHaveAttribute('aria-rowcount', '1508');
    expect(await songs(page).locator('tbody tr:not(.pl-spacer)').count()).toBeLessThan(80);
    await songs(page).focus();
    await page.keyboard.press('End');
    await expect(songs(page).locator('[aria-selected="true"]')).toContainText('untagged');
    await expect(songs(page).locator('[aria-selected="true"]')).toBeInViewport();
    expect(errors).toEqual([]);
  });
});
