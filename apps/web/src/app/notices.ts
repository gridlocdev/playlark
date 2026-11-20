/** The status bar's notice (PRD §13): one at a time, read out, with an action such as Undo where there is one. */
import { signal } from '@preact/signals';
import { after } from '@playlark/ui';

export interface Notice {
  readonly text: string;
  readonly tone?: 'error';
  /** Stays until dismissed or replaced. Errors are sticky. */
  readonly sticky?: boolean;
  readonly action?: { readonly label: string; readonly run: () => void };
}

/** How long a notice stays: 6 s, or 12 s with an action (PRD §13). */
export const NOTICE_MS = 6_000;
export const NOTICE_ACTION_MS = 12_000;

export class Notices {
  readonly notice = signal<Notice | null>(null);
  /** Read out by the status bar's live region. */
  readonly announcement = signal('');
  #timer: (() => void) | null = null;

  say(text: string, options: Omit<Notice, 'text'> = {}): void {
    this.#timer?.();
    const sticky = options.sticky ?? options.tone === 'error';
    this.notice.value = { text, ...options, sticky };
    this.announcement.value = text;
    this.#timer = sticky
      ? null
      : after(options.action ? NOTICE_ACTION_MS : NOTICE_MS, () => {
          this.notice.value = null;
        });
  }

  dismiss(): void {
    this.#timer?.();
    this.#timer = null;
    this.notice.value = null;
  }
}
