/**
 * Roving focus for a list or grid of buttons (album covers, artists, folders): the list is one Tab stop, the
 * arrow keys move inside it, and which item has focus lives in a signal. DOM focus follows that signal, so a
 * click, a key, a dialog closing or a redraw never leaves the visible focus somewhere the app doesn't know about.
 */
import { signal } from '@preact/signals';

/**
 * The item after a navigation key in a list of `count` items laid out `columns` to a row, or undefined for keys
 * the list doesn't handle. A one-column list ignores ← and →.
 */
export function rovingStep(key: string, index: number, count: number, columns = 1): number | undefined {
  if (count === 0) return undefined;
  const at = (i: number) => Math.max(0, Math.min(count - 1, i));
  switch (key) {
    case 'ArrowRight':
      return columns > 1 ? at(index + 1) : undefined;
    case 'ArrowLeft':
      return columns > 1 ? at(index - 1) : undefined;
    case 'ArrowDown':
      return at(index + columns);
    case 'ArrowUp':
      return at(index - columns);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

/** The key parts `RovingFocus.keyDown` reads. */
export interface RovingKey {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  preventDefault(): void;
}

/** One list's focused item. Keep it in the model (the controller), so it outlives the list's component. */
export class RovingFocus {
  /** The focused item, or the one Tab comes back to. */
  readonly index = signal(0);
  /** Set by a key, so the item that becomes current also takes DOM focus when it is drawn. */
  #pull = false;

  /** The current item in a list of `count` (the index can be past the end after the list shrinks). */
  current(count: number): number {
    return Math.max(0, Math.min(count - 1, this.index.value));
  }

  /** The item's tabIndex: only the current item is a Tab stop. */
  tabIndex(i: number, count: number): 0 | -1 {
    return i === this.current(count) ? 0 : -1;
  }

  /** The item took DOM focus (a click, Tab, or the focus going back after a dialog): it becomes current. */
  focused(i: number): void {
    this.index.value = i;
  }

  /** Moves on an arrow, Home or End key. Returns true when it handled the key. */
  keyDown(e: RovingKey, count: number, columns = 1): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
    const next = rovingStep(e.key, this.current(count), count, columns);
    if (next === undefined) return false;
    e.preventDefault();
    this.#pull = true;
    this.index.value = next;
    return true;
  }

  /** Takes focus to the current item when it is next drawn (the list was scrolled to it first). */
  pull(): void {
    this.#pull = true;
  }

  /** The ref for item `i`: gives it DOM focus when a key just made it current. */
  ref(i: number): (el: { focus(): void } | null) => void {
    return (el) => {
      if (!el || !this.#pull || i !== this.index.peek()) return;
      this.#pull = false;
      el.focus();
    };
  }
}
