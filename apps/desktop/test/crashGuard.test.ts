import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Runs `body` in a fresh Node process with the guard installed; exiting through it gives code 7. */
function crash(body: string) {
  const guard = pathToFileURL(path.join(src, 'crashGuard.ts')).href;
  const script = `import { guardMainErrors } from ${JSON.stringify(guard)};
guardMainErrors(process, () => process.exit(7));
${body}`;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
}

describe('guardMainErrors', () => {
  it('logs an uncaught exception and exits through the guard', () => {
    const run = crash(`setTimeout(() => { throw new Error('boom'); });`);
    expect(run.status).toBe(7);
    expect(run.stderr).toContain('Uncaught exception in the main process:');
    expect(run.stderr).toContain('boom');
  });

  it('logs an unhandled rejection and exits through the guard', () => {
    const run = crash(`Promise.reject(new Error('lost promise'));`);
    expect(run.status).toBe(7);
    expect(run.stderr).toContain('Unhandled rejection in the main process:');
    expect(run.stderr).toContain('lost promise');
  });

  it('is installed by the first import of the main process, before any other module runs', () => {
    const main = readFileSync(path.join(src, 'main.ts'), 'utf8');
    const firstImport = /^import\s[^;]*;/m.exec(main)?.[0];
    expect(firstImport).toBe(`import './headlessStart.ts';`);
  });
});
