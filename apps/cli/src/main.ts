/**
 * `playlark` (PRD §20): the music folder from a terminal. `playlark --help` lists the commands; run.ts does the work.
 *   PLAYLARK_DIR        the music folder when --dir isn't given (else the desktop app's folder)
 *   PLAYLARK_USER_DATA  the desktop app's data folder, when it isn't in the usual place
 */
import { homedir } from 'node:os';
import { run } from './run.ts';
import { systemPlayer } from './play.ts';

const argv = process.argv.slice(2);
const out = (line: string) => process.stdout.write(`${line}\n`);
const err = (line: string) => process.stderr.write(`${line}\n`);
const code = await run(argv, {
  env: process.env,
  platform: process.platform,
  home: homedir(),
  cwd: process.cwd(),
  out,
  err,
  player: systemPlayer(process.env, argv.includes('--json') ? err : out),
});
process.exitCode = code;
