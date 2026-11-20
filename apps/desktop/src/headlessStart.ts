/**
 * The first module main.ts imports, so in a headless run (`--headless` or PLAYLARK_HEADLESS=1) the error guard
 * and the hidden Dock icon are in place before any other module's code runs.
 */
import { app } from 'electron';
import { guardMainErrors } from './crashGuard.ts';
import { isHeadless } from './paths.ts';

if (isHeadless(process.argv, process.env)) {
  guardMainErrors(process, (code) => app.exit(code));
  app.dock?.hide();
}
