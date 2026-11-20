// The queue (PRD §8.2, §8.4, §8.5): editing Up Next, Play Next and Add to Queue, shuffle, repeat, and the queue
// put back after a reload.
import type { Page } from '@playwright/test';
import { expect, nowPlaying, openApp, runCommand, songs, test, waitForApp, watchErrors } from './fixtures.ts';

test.beforeEach(({ seed }) => seed('basic'));

const queuePanel = (page: Page) => page.getByRole('complementary', { name: 'Queue' });
const upNext = (page: Page) => queuePanel(page).getByRole('listbox', { name: 'Up Next' });
const upNextTitles = (page: Page) => upNext(page).locator('.pl-queue-title').allInnerTexts();

/** Plays the list from `title`, pauses at once so the 2 s songs stay put, and shows the queue. */
async function playPaused(page: Page, title: string): Promise<void> {
  await songs(page)
    .getByRole('row', { name: new RegExp(title) })
    .dblclick();
  await expect(nowPlaying(page)).toContainText(title);
  await nowPlaying(page).getByRole('button', { name: 'Pause' }).click();
  await runCommand(page, 'Show Queue');
}

test.describe('The queue', () => {
  test('Up Next loses a song to its × or Delete, takes a drag to reorder, and Clear empties it', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await playPaused(page, 'Rain on Tin');
    await expect
      .poll(() => upNextTitles(page))
      .toEqual(['Morning Tide', 'Salt Air', 'Lantern Walk', 'Static Bloom', 'Night Bus', 'untagged']);
    // The × shows on hover and is for the mouse; an option's contents are presentational, so screen readers use
    // Delete.
    const salt = upNext(page).getByRole('option', { name: /Salt Air/ });
    await salt.hover();
    await salt.locator('.pl-queue-remove').click();
    await upNext(page)
      .getByRole('option', { name: /Night Bus/ })
      .click();
    await page.keyboard.press('Delete');
    await expect
      .poll(() => upNextTitles(page))
      .toEqual(['Morning Tide', 'Lantern Walk', 'Static Bloom', 'untagged']);
    await upNext(page)
      .getByRole('option', { name: /untagged/ })
      .dragTo(upNext(page).getByRole('option', { name: /Morning Tide/ }), {
        targetPosition: { x: 20, y: 2 },
      });
    await expect
      .poll(() => upNextTitles(page))
      .toEqual(['untagged', 'Morning Tide', 'Lantern Walk', 'Static Bloom']);
    await queuePanel(page).getByRole('button', { name: 'Clear' }).click();
    await expect(queuePanel(page)).toContainText('Nothing after this song.');
    await expect(nowPlaying(page)).toContainText('Rain on Tin');
    expect(errors).toEqual([]);
  });
});

test.describe('Play Next and Add to Queue', () => {
  test('the song menu puts a song next or last, and says so', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await playPaused(page, 'Rain on Tin');
    await runCommand(page, 'Clear Up Next');
    await songs(page)
      .getByRole('row', { name: /Night Bus/ })
      .click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Add to Queue' }).click();
    await expect(page.locator('.pl-status')).toContainText('Added Night Bus to the queue.');
    await songs(page)
      .getByRole('row', { name: /Salt Air/ })
      .click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Play Next' }).click();
    await expect(page.locator('.pl-status')).toContainText('Playing next: Salt Air');
    await expect.poll(() => upNextTitles(page)).toEqual(['Salt Air', 'Night Bus']);
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await expect(nowPlaying(page)).toContainText('Salt Air');
    expect(errors).toEqual([]);
  });
});

test.describe('Shuffle and repeat', () => {
  test('an album’s Shuffle button plays it shuffled, and the toggles cycle', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name: 'Albums' }).click();
    await page
      .getByRole('region', { name: 'Albums' })
      .getByRole('button', { name: /Harbour Lights/ })
      .click();
    await page.getByRole('button', { name: 'Shuffle Harbour Lights' }).click();
    const bar = nowPlaying(page);
    const shuffle = bar.getByRole('button', { name: 'Shuffle' });
    await expect(shuffle).toHaveAttribute('aria-pressed', 'true');
    await bar.getByRole('button', { name: 'Pause' }).click();
    await runCommand(page, 'Show Queue');
    const playing = await queuePanel(page).locator('.pl-playing .pl-queue-title').innerText();
    const rest = await upNextTitles(page);
    expect([playing, ...rest].sort()).toEqual(['Lantern Walk', 'Morning Tide', 'Salt Air']);
    await page.keyboard.press('ControlOrMeta+KeyS');
    await expect(shuffle).toHaveAttribute('aria-pressed', 'false');

    await bar.getByRole('button', { name: 'Repeat' }).click();
    await expect(bar.getByRole('button', { name: 'Repeat All' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ControlOrMeta+Alt+KeyR');
    await expect(bar.getByRole('button', { name: 'Repeat One' })).toBeVisible();
    // Repeat One plays the 2 s song again instead of moving on.
    await bar.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(3_000);
    await expect(bar).toContainText(playing);
    await expect(bar.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Alt+KeyR');
    await expect(bar.getByRole('button', { name: 'Repeat' })).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
  });
});

test.describe('Picking up where you left off', () => {
  test('after a reload the queue is back, paused on the same song', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await playPaused(page, 'Salt Air');
    const kept = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const open = indexedDB.open('playlark');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const count = open.result.transaction('queue').objectStore('queue').count();
              count.onerror = () => reject(count.error);
              count.onsuccess = () => resolve(count.result);
            };
          }),
      );
    await expect.poll(kept).toBe(1);
    await page.reload();
    await waitForApp(page);
    const bar = nowPlaying(page);
    await expect(bar).toContainText('Salt Air');
    await expect(bar.getByRole('button', { name: 'Play' })).toBeVisible();
    await runCommand(page, 'Show Queue');
    await expect
      .poll(() => upNextTitles(page))
      .toEqual(['Lantern Walk', 'Static Bloom', 'Night Bus', 'untagged']);
    await bar.getByRole('button', { name: 'Play' }).click();
    await expect(bar.getByRole('button', { name: 'Pause' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
