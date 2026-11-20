/** The play queue (PRD §6): the songs in play order and which one is playing. Pure: every change returns a new queue. */

export interface Queue {
  /** Song paths in play order. */
  readonly items: readonly string[];
  /** The playing (or paused) item's index, or -1 when nothing is. */
  readonly index: number;
}

export const EMPTY_QUEUE: Queue = { items: [], index: -1 };

/** Playing from a list replaces the queue with the list, starting at `index`. */
export function playFrom(items: readonly string[], index: number): Queue {
  if (items.length === 0) return EMPTY_QUEUE;
  return { items: [...items], index: Math.max(0, Math.min(index, items.length - 1)) };
}

export function current(q: Queue): string | undefined {
  return q.index >= 0 ? q.items[q.index] : undefined;
}

/** The next song, or null at the end of the queue. */
export function next(q: Queue): Queue | null {
  return q.index + 1 < q.items.length ? { ...q, index: q.index + 1 } : null;
}

/** Previous restarts the song when it's more than 3 seconds in, else goes back one (PRD §6). */
export const RESTART_AFTER = 3;

export function previous(q: Queue, position: number): { queue: Queue; restart: boolean } {
  if (position > RESTART_AFTER || q.index <= 0) return { queue: q, restart: true };
  return { queue: { ...q, index: q.index - 1 }, restart: false };
}

/** Drops songs that are no longer in the library, keeping the playing one where it can. */
export function prune(q: Queue, exists: (path: string) => boolean): Queue {
  const playing = current(q);
  const items = q.items.filter(exists);
  if (items.length === 0) return EMPTY_QUEUE;
  let index = playing === undefined ? -1 : items.indexOf(playing);
  if (index < 0 && q.index >= 0)
    index = Math.min(q.items.slice(0, q.index).filter(exists).length, items.length - 1);
  return { items, index };
}
