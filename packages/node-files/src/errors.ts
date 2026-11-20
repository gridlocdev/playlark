/**
 * Why a folder call was refused. `changed`, `deleted` and `exists` are the conflicts of a conditional write or a
 * move; `not-found` a file that isn't there; `outside` a path that leaves the folder; `busy` a file another
 * program is saving (its lock file is held past the wait, PRD §3).
 */
export type FolderErrorCode = 'changed' | 'deleted' | 'exists' | 'not-found' | 'outside' | 'busy';

export class FolderError extends Error {
  readonly code: FolderErrorCode;

  constructor(code: FolderErrorCode, message: string) {
    super(message);
    this.name = 'FolderError';
    this.code = code;
  }
}
