/**
 * Undo and Redo (PRD §9.2, ⌘Z / ⇧⌘Z): every playlist edit is a step. A step knows how to take itself back and
 * do itself again; a new step drops what Redo had.
 */
import { type Signal, computed, signal } from '@preact/signals';

type Steps = Signal<readonly UndoStep[]>;

export interface UndoStep {
  /** What the step did, for the notice ("Undo Add to Playlist"). */
  readonly label: string;
  undo(): Promise<void> | void;
  redo(): Promise<void> | void;
}

/** How many steps Undo goes back through. */
export const UNDO_LIMIT = 100;

export class UndoStack {
  readonly #done = signal<readonly UndoStep[]>([]);
  readonly #undone = signal<readonly UndoStep[]>([]);
  readonly canUndo = computed(() => this.#done.value.length > 0);
  readonly canRedo = computed(() => this.#undone.value.length > 0);
  #busy: Promise<void> = Promise.resolve();

  push(step: UndoStep): void {
    this.#done.value = [...this.#done.peek(), step].slice(-UNDO_LIMIT);
    this.#undone.value = [];
  }

  /** Forgets every step (another folder was opened). */
  clear(): void {
    this.#done.value = [];
    this.#undone.value = [];
  }

  /** Takes the last step back; steps run one at a time, in order. Gives its label, or null with none. */
  undo(): Promise<string | null> {
    return this.#move(this.#done, this.#undone, (s) => s.undo());
  }

  redo(): Promise<string | null> {
    return this.#move(this.#undone, this.#done, (s) => s.redo());
  }

  #move(from: Steps, to: Steps, run: (step: UndoStep) => Promise<void> | void): Promise<string | null> {
    const step = from.peek().at(-1);
    if (!step) return Promise.resolve(null);
    from.value = from.peek().slice(0, -1);
    to.value = [...to.peek(), step];
    const done = this.#busy.then(() => run(step)).then(() => step.label);
    this.#busy = done.then(
      () => undefined,
      () => undefined,
    );
    return done;
  }
}
