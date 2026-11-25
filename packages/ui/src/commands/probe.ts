/**
 * The Keyboard Shortcuts window's "press a shortcut" mode (PRD §14): while it is on, a key press runs nothing and
 * the window says which command that key runs. It can never trap the keyboard: Escape always ends it and is
 * passed on untouched, and if anything throws while handling a key, the listener is removed before the error
 * goes on.
 */
import { signal } from '@preact/signals';
import type { Command, CommandCatalog } from './command.ts';
import {
  SEQUENCE_MS,
  isComposingKey,
  isMac,
  matchRank,
  type Shortcut,
  type ShortcutEvent,
} from './shortcut.ts';

/** What a pressed key does: a command, the first key of a two-key command, or nothing. */
export type ProbeResult =
  | { readonly kind: 'command'; readonly command: Command }
  | { readonly kind: 'first'; readonly keys: string[] }
  | { readonly kind: 'none' };

export type ProbeEvent = ShortcutEvent & {
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  preventDefault(): void;
  stopImmediatePropagation(): void;
};

interface KeyTarget {
  addEventListener(type: 'keydown', listener: (e: ProbeEvent) => void, options: { capture: boolean }): void;
  removeEventListener(
    type: 'keydown',
    listener: (e: ProbeEvent) => void,
    options: { capture: boolean },
  ): void;
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'OS']);

/**
 * Which command `e` runs, whether or not it is enabled now. `pending` is the first key of a two-key sequence
 * pressed just before, if any.
 */
export function probeKey(
  catalog: CommandCatalog,
  e: ShortcutEvent,
  pending: { readonly first: Shortcut; readonly at: number } | null,
  now: number,
  mac = isMac,
): ProbeResult & { readonly first?: Shortcut } {
  if (pending && now - pending.at <= SEQUENCE_MS)
    for (const command of catalog.all)
      for (const [a, b, ...more] of command.sequences)
        if (a === pending.first && b && more.length === 0 && matchRank(b, e, mac) > 0)
          return { kind: 'command', command };
  let best: Command | undefined;
  let bestRank = Infinity;
  for (const command of catalog.all)
    for (const seq of command.sequences) {
      const [only] = seq;
      if (seq.length !== 1 || !only) continue;
      const rank = matchRank(only, e, mac);
      if (rank > 0 && rank < bestRank) {
        best = command;
        bestRank = rank;
      }
    }
  if (best) return { kind: 'command', command: best };
  for (const command of catalog.all)
    for (const seq of command.sequences) {
      const [a] = seq;
      if (seq.length === 2 && a && matchRank(a, e, mac) > 0)
        return { kind: 'first', keys: catalog.keys({ ...command, sequences: [[a]] }, mac), first: a };
    }
  return { kind: 'none' };
}

export interface ProbeOptions {
  /** Hears each key's result. */
  readonly onKey: (result: ProbeResult) => void;
  /** Hears that the mode ended: by Escape, by `stop`, by an error, or because it is no longer `active`. */
  readonly onEnd: () => void;
  /** False once the window that shows the results is gone; the next key then ends the mode and goes through. */
  readonly active?: () => boolean;
  readonly now?: () => number;
  readonly mac?: boolean;
}

/**
 * Starts the mode on `target` (the window). Returns `stop`, which is safe to call more than once; call it when
 * the window closes.
 */
export function startProbe(target: KeyTarget, catalog: CommandCatalog, options: ProbeOptions): () => void {
  const { onKey, onEnd, active = () => true, now = Date.now, mac = isMac } = options;
  let pending: { readonly first: Shortcut; readonly at: number } | null = null;
  let on = true;
  const stop = () => {
    if (!on) return;
    on = false;
    target.removeEventListener('keydown', listener, { capture: true });
    onEnd();
  };
  // Capture phase, so the key is seen (and stopped) before the app's own listener runs it.
  const listener = (e: ProbeEvent) => {
    if (e.key === 'Escape' || !active()) {
      stop();
      return;
    }
    let handled = false;
    try {
      e.preventDefault();
      e.stopImmediatePropagation();
      // A modifier on its own, or a key that is part of typing an accented letter, says nothing yet.
      if (MODIFIERS.has(e.key) || isComposingKey(e)) {
        handled = true;
        return;
      }
      const at = now();
      const result = probeKey(catalog, e, pending, at, mac);
      pending = result.kind === 'first' && result.first ? { first: result.first, at } : null;
      onKey(result.kind === 'first' ? { kind: 'first', keys: result.keys } : result);
      handled = true;
    } finally {
      if (!handled) stop();
    }
  };
  target.addEventListener('keydown', listener, { capture: true });
  return stop;
}

/** The mode as a model the Keyboard Shortcuts window reads: whether it is on, and the last key's result. */
export class KeyProbe {
  readonly on = signal(false);
  readonly result = signal<ProbeResult | null>(null);
  #stop: (() => void) | null = null;

  start(target: KeyTarget, catalog: CommandCatalog, active: () => boolean): void {
    this.stop();
    this.result.value = null;
    this.on.value = true;
    this.#stop = startProbe(target, catalog, {
      onKey: (r) => (this.result.value = r),
      onEnd: () => {
        this.#stop = null;
        this.on.value = false;
      },
      active,
    });
  }

  stop(): void {
    this.#stop?.();
  }
}
