/**
 * Electron shows an uncaught main-process error, or an unhandled promise rejection, in a dialog on the screen,
 * hidden window or not. A headless run writes it to stderr and exits with an error instead, so the check fails
 * and nothing appears. No Electron imports, so tests run it in Node.
 */

/** Sends both kinds of error to `log`, then `exit(1)`. */
export function guardMainErrors(
  proc: Pick<NodeJS.Process, 'on'>,
  exit: (code: number) => void,
  log: (message: string, error: unknown) => void = console.error,
): void {
  proc.on('uncaughtException', (error) => {
    log('Uncaught exception in the main process:', error);
    exit(1);
  });
  proc.on('unhandledRejection', (reason) => {
    log('Unhandled rejection in the main process:', reason);
    exit(1);
  });
}
