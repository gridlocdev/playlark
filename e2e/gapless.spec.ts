// The gapless join (PRD §8.3, §21): two halves of one sine, decoded and scheduled by the app's own engine in a real
// browser, must render as the unbroken sine, with no gap, overlap or click at the join.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test, watchErrors } from './fixtures.ts';
import { ROOT } from './server.ts';

interface JoinResult {
  readonly frames: readonly [number, number];
  readonly errorAtJoin: number;
  readonly errorElsewhere: number;
  readonly lag: number;
}

let harness = '';

test.beforeAll(() => {
  execFileSync(
    'pnpm',
    ['-s', '--filter', '@playlark/web', 'exec', 'vite', 'build', '--config', 'test/join/vite.config.ts'],
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  );
  harness = readFileSync(`${ROOT}.e2e-build/join.js`, 'utf8');
});

test.beforeEach(({ seed }) => seed('gapless'));

const media = (album: string, file: string) =>
  `/api/media/${encodeURIComponent(album)}/${encodeURIComponent(file)}`;

test.describe('Gapless playback', () => {
  for (const [ext, tolerance] of [
    ['wav', 1e-4],
    ['flac', 1e-4],
    // MP3 is lossy: the join is checked against the error the encoding leaves everywhere else.
    ['mp3', 0],
  ] as const) {
    test(`two halves of one sine in ${ext.toUpperCase()} join on the exact sample`, async ({ page }) => {
      const errors = watchErrors(page);
      // The app's CSP allows only its own scripts, so the harness is served from its origin.
      await page.route('**/join-harness.js', (route) =>
        route.fulfill({ contentType: 'text/javascript', body: harness }),
      );
      await page.goto('/');
      await page.addScriptTag({ url: '/join-harness.js' });
      const album = `Join ${ext}`;
      const result = await page.evaluate(
        ([a, b]) =>
          (window as unknown as { playlarkJoin: (a: string, b: string) => Promise<JoinResult> }).playlarkJoin(
            a,
            b,
          ),
        [media(album, `01 First Half.${ext}`), media(album, `02 Second Half.${ext}`)] as const,
      );
      expect(result.frames).toEqual([66_150, 66_150]);
      expect(result.lag).toBe(0);
      if (tolerance > 0) expect(result.errorAtJoin).toBeLessThan(tolerance);
      else expect(result.errorAtJoin).toBeLessThan(2 * result.errorElsewhere);
      expect(errors).toEqual([]);
    });
  }
});
