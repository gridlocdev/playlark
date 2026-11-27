// Playlists in the browser, served by the NAS server: listed in the sidebar, played, and missing entries greyed.
// Editing them is checked in the desktop app (desktop.spec.ts); here the folder can't be written yet.
import { expect, nowPlaying, openApp, seedMix, test, watchErrors } from './fixtures.ts';

test.beforeEach(({ seed }) => {
  seed('basic');
  seedMix();
});

test.describe('Playlists', () => {
  test('lists the folder’s playlists, shows missing songs greyed and skips them when played', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openApp(page);
    const sidebar = page.getByRole('list', { name: 'Playlists' });
    await sidebar.getByRole('button', { name: 'Mix' }).click();
    await expect(page.locator('.pl-view-title')).toHaveText('Mix');
    const list = page.getByRole('grid', { name: 'Mix' });
    await expect(list.locator('tbody tr td.pl-col-title')).toHaveText([
      'Rain on Tin',
      'Missing: Gone/away.mp3',
      'untagged',
    ]);
    const gone = list.getByRole('row', { name: /Missing/ });
    await expect(gone).toHaveClass(/pl-unreadable/);
    // A missing entry has no tags to show, and the count says what plays.
    await expect(gone.locator('td.pl-col-artist')).toHaveText('');
    await expect(gone.locator('td.pl-col-album')).toHaveText('');
    await expect(page.locator('.pl-page-facts')).toHaveText('2 songs · 1 missing');
    await page.getByRole('button', { name: 'Play Mix' }).click();
    const bar = nowPlaying(page);
    await expect(bar).toContainText('Rain on Tin');
    await expect(bar, 'the missing song is skipped').toContainText('untagged', { timeout: 10_000 });
    expect(errors).toEqual([]);
  });
});
