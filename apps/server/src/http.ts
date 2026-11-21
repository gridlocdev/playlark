import type http from 'node:http';
import { FolderError, type FolderErrorCode } from '@playlark/node-files';

/** An error the server answers with its own status and message. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: FolderErrorCode | 'failed';
  constructor(status: number, message: string, code: FolderErrorCode | 'failed' = 'failed') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The status each refusal answers with. */
export const FOLDER_STATUS: Record<FolderErrorCode, number> = {
  changed: 412,
  deleted: 412,
  exists: 409,
  'not-found': 404,
  outside: 403,
  busy: 503,
};

/** A FolderError as the HTTP error it means; anything else unchanged. */
export function httpError(e: unknown): unknown {
  if (e instanceof FolderError) return new HttpError(FOLDER_STATUS[e.code], e.message, e.code);
  if (typeof e === 'object' && e !== null && 'code' in e && (e.code === 'ENOENT' || e.code === 'ENOTDIR'))
    return new HttpError(404, 'Not found', 'not-found');
  return e;
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
  });
  res.end(text);
}
