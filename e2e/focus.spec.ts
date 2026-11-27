// Keyboard focus: the app draws every focus mark from one token, and the mark follows the app's own state.
import type { Page } from '@playwright/test';
import { expect, openApp, runCommand, songs, test, watchErrors } from './fixtures.ts';

test.beforeEach(({ seed }) => seed('basic'));

/**
 * How the focused element shows its focus: 'outline' (its own ring), 'cover' (an album card's cover), 'field'
 * (the search box or the command menu's field), 'row' (a list's cursor row, or the list's own ring), or a
 * description of what is wrong. Every ring must be the focus token's colour; anything else is the browser's.
 */
function focusMark(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'nothing focused';
    const colour = (value: string) => {
      const probe = document.createElement('i');
      probe.style.color = value;
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    };
    const focus = colour('var(--pl-focus)');
    const onAccent = colour('var(--pl-focus-on-accent)');
    const ringed = (s: CSSStyleDeclaration) =>
      s.outlineStyle === 'solid' && parseFloat(s.outlineWidth) >= 2 && s.outlineColor === focus;
    const own = getComputedStyle(el);
    if (ringed(own)) return 'outline';
    if (own.outlineStyle !== 'none') return `browser outline (${own.outlineStyle} ${own.outlineColor})`;
    const cover = el.querySelector('.pl-cover');
    if (cover && ringed(getComputedStyle(cover))) return 'cover';
    const box = el.closest('.pl-search');
    if (box && getComputedStyle(box).borderColor === focus) return 'field';
    if (el.closest('.pl-palette') && own.boxShadow.includes(focus)) return 'field';
    const cursor = el.querySelector('.pl-cursor');
    const marked = cursor?.matches('tr') ? cursor.querySelector('td') : cursor;
    const shadow = marked ? getComputedStyle(marked).boxShadow : '';
    if (shadow.includes(focus) || shadow.includes(onAccent)) return 'row';
    return `no focus mark on ${el.tagName.toLowerCase()}.${el.className}`;
  });
}

/** Tabs through the whole window once and returns each stop's mark, keyed by what it is. */
async function tabAround(page: Page): Promise<Map<string, string>> {
  const marks = new Map<string, string>();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(() => {
      const el = document.activeElement;
      // Tab passes through the page itself (the browser's address bar, in a window) between rounds.
      if (!el || el === document.body) return null;
      const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent?.trim();
      return `${el.tagName.toLowerCase()} ${label?.slice(0, 40)}`;
    });
    if (name === null) continue;
    if (marks.has(name)) break;
    marks.set(name, await focusMark(page));
  }
  return marks;
}

const ALLOWED = new Set(['outline', 'cover', 'field', 'row']);

test.describe('Keyboard focus', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`every Tab stop shows the app's own focus mark, never the browser's (${scheme})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await page.emulateMedia({ colorScheme: scheme });
      await openApp(page);
      // Something playing and the queue showing, so the player and the queue are Tab stops too.
      await songs(page).locator('tbody tr').first().dblclick();
      await runCommand(page, 'Show Queue');
      const onSongs = await tabAround(page);
      await page.keyboard.press('ControlOrMeta+Digit2');
      const onAlbums = await tabAround(page);
      const bad = [...onSongs, ...onAlbums].filter(([, mark]) => !ALLOWED.has(mark));
      expect(bad).toEqual([]);
      expect(onSongs.size).toBeGreaterThan(15);
      expect([...onSongs.values()]).toContain('row');
      expect([...onAlbums.values()]).toContain('cover');
      expect(errors).toEqual([]);
    });
  }

  test('the arrow keys move the current album and the focus mark together', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await page.keyboard.press('ControlOrMeta+Digit2');
    const grid = page.getByRole('region', { name: 'Albums' });
    const cards = grid.getByRole('button');
    const count = await cards.count();
    expect(count).toBeGreaterThan(2);
    await cards.first().focus();
    // The grid is one Tab stop: the current card.
    await expect(grid.locator('button[tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('ArrowRight');
    await expect(cards.nth(1)).toBeFocused();
    await expect(cards.nth(1)).toHaveAttribute('tabindex', '0');
    await expect(cards.first()).toHaveAttribute('tabindex', '-1');
    expect(await focusMark(page)).toBe('cover');
    await page.keyboard.press('End');
    await expect(cards.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(cards.first()).toBeFocused();
    await page.keyboard.press('ArrowRight');

    // Opening the album and coming back with the keyboard puts focus back on its cover.
    const title = await cards.nth(1).getAttribute('title');
    await page.keyboard.press('Enter');
    await expect(grid).toBeHidden();
    await page.keyboard.press('ControlOrMeta+BracketLeft');
    await expect(page.locator(`.pl-card[title="${title}"]`)).toBeFocused();
    expect(await focusMark(page)).toBe('cover');
    expect(errors).toEqual([]);
  });

  test('the song list rings its cursor row, and the ring moves with the arrow keys', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    const list = songs(page);
    const rows = list.locator('tbody tr[role="row"]');
    await rows.first().click();
    await expect(list).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(list.locator('tr.pl-cursor')).toHaveCount(1);
    const id = await rows.nth(2).getAttribute('id');
    await expect(rows.nth(2)).toHaveClass(/pl-cursor/);
    await expect(list).toHaveAttribute('aria-activedescendant', id!);
    expect(await focusMark(page)).toBe('row');
    // With several rows selected, the ring stays on the one the keys move from.
    await page.keyboard.press('Shift+ArrowUp');
    await expect(rows.nth(1)).toHaveClass(/pl-cursor/);
    await expect(rows.nth(2)).not.toHaveClass(/pl-cursor/);
    expect(errors).toEqual([]);
  });

  test('Shift+F10 and the Menu key open the song menu with the keyboard in it, and Esc gives it back', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openApp(page);
    const list = songs(page);
    await list.locator('tbody tr[role="row"]').first().click();
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Song' });
    for (const key of ['Shift+F10', 'ContextMenu']) {
      await page.keyboard.press(key);
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem').first()).toBeFocused();
      // The menu opens under the cursor row.
      const row = await list.locator('tr.pl-cursor').boundingBox();
      const box = await menu.boundingBox();
      expect(Math.abs(box!.y - (row!.y + row!.height))).toBeLessThan(2);
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(list).toBeFocused();
      await expect(list.locator('tbody tr[aria-selected="true"]')).toHaveCount(1);
    }
    expect(errors).toEqual([]);
  });

  test('closing a dialog puts focus back on the item it was opened from', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    const list = songs(page);
    const rows = list.locator('tbody tr[role="row"]');
    await rows.first().click();
    await page.keyboard.press('ArrowDown');
    // Song Info by its key, then from ⌘K (the dialog replaces the command menu, whose field is then gone).
    await page.keyboard.press('ControlOrMeta+KeyI');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(list).toBeFocused();
    await expect(rows.nth(1)).toHaveClass(/pl-cursor/);
    await runCommand(page, 'Song Info');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(list).toBeFocused();
    await expect(rows.nth(1)).toHaveClass(/pl-cursor/);
    expect(await focusMark(page)).toBe('row');

    // An album cover: Keyboard Shortcuts, then Escape.
    await page.keyboard.press('ControlOrMeta+Digit2');
    const cards = page.getByRole('region', { name: 'Albums' }).getByRole('button');
    await cards.first().focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+Slash');
    await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(cards.nth(1)).toBeFocused();
    expect(await focusMark(page)).toBe('cover');
    expect(errors).toEqual([]);
  });
});
