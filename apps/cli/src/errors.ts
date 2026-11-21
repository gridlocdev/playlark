/** Exit codes (PRD §20): 1 an error or a usage mistake, 2 a conflict (the file changed or exists already). */
export type ExitCode = 1 | 2;

export class CliError extends Error {
  readonly exit: ExitCode;

  constructor(message: string, exit: ExitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exit = exit;
  }
}
