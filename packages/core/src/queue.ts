/**
 * The play queue (PRD §8.4, §8.5): the songs in play order, which one is playing, shuffle and repeat. Pure: every
 * change returns a new queue.
 */

export type Repeat = 'off' | 'all' | 'one';

export interface Queue {
  /** Song paths in play order. A path may be in it more than once. */
  readonly items: readonly string[];
  /** The playing (or paused) item's index, or -1 when nothing is. */
  readonly index: number;
  readonly repeat: Repeat;
  /**
   * With shuffle on, each item's place in the order before shuffling (any numbers that sort that way); turning
   * shuffle off sorts the items by it. Null with shuffle off.
   */
  readonly rank: readonly number[] | null;
}

export const EMPTY_QUEUE: Queue = { items: [], index: -1, repeat: 'off', rank: null };

export const isShuffled = (q: Queue): boolean => q.rank !== null;

/**
 * Playing from a list replaces the queue with the list, starting at `index`. Repeat stays as set; with shuffle on,
 * what comes after the chosen song is shuffled (§8.5).
 */
export function playFrom(
  items: readonly string[],
  index: number,
  from: Queue = EMPTY_QUEUE,
  seed = 0,
): Queue {
  if (items.length === 0) return { ...EMPTY_QUEUE, repeat: from.repeat };
  const q: Queue = {
    items: [...items],
    index: Math.max(0, Math.min(index, items.length - 1)),
    repeat: from.repeat,
    rank: null,
  };
  return isShuffled(from) ? shuffleAfterCurrent(q, seed) : q;
}

/** The Shuffle buttons (§8.2): shuffle on, the whole list shuffled, playing from its new first song. */
export function shuffleAll(items: readonly string[], seed: number, from: Queue = EMPTY_QUEUE): Queue {
  if (items.length === 0) return { ...EMPTY_QUEUE, repeat: from.repeat };
  const order = shuffled(
    items.map((_, i) => i),
    seed,
  );
  return { items: order.map((i) => items[i]!), index: 0, repeat: from.repeat, rank: order };
}

export function current(q: Queue): string | undefined {
  return q.index >= 0 ? q.items[q.index] : undefined;
}

/**
 * The entry after this one, or null at the end. `auto`: the song ended by itself, so Repeat One plays it again;
 * Next pressed by hand moves on even then (§8.5).
 */
export function next(q: Queue, auto = false): Queue | null {
  if (q.index < 0) return null;
  if (auto && q.repeat === 'one') return q;
  if (q.index + 1 < q.items.length) return { ...q, index: q.index + 1 };
  return q.repeat === 'off' ? null : { ...q, index: 0 };
}

/** The path that plays when this one ends by itself, or undefined when the queue stops there. */
export function following(q: Queue): string | undefined {
  const n = next(q, true);
  return n ? current(n) : undefined;
}

/** Previous restarts the song when it's more than 3 seconds in, else goes back one (§8.4). */
export const RESTART_AFTER = 3;

export function previous(q: Queue, position: number): { queue: Queue; restart: boolean } {
  if (position > RESTART_AFTER || q.index <= 0) return { queue: q, restart: true };
  return { queue: { ...q, index: q.index - 1 }, restart: false };
}

export function jumpTo(q: Queue, index: number): Queue | null {
  return index >= 0 && index < q.items.length ? { ...q, index } : null;
}

/** Play Next (§8.2): right after the playing song, in the shuffled and the original order alike (§8.5). */
export function playNext(q: Queue, paths: readonly string[]): Queue {
  if (paths.length === 0) return q;
  if (q.index < 0) return addToQueue(q, paths);
  const at = q.index + 1;
  const items = [...q.items.slice(0, at), ...paths, ...q.items.slice(at)];
  if (!q.rank) return { ...q, items };
  // Ranks between the playing song's and the next one up in the original order.
  const mine = q.rank[q.index]!;
  const above = Math.min(...q.rank.filter((r) => r > mine), mine + 1);
  const step = (above - mine) / (paths.length + 1);
  const added = paths.map((_, i) => mine + step * (i + 1));
  return { ...q, items, rank: [...q.rank.slice(0, at), ...added, ...q.rank.slice(at)] };
}

/** Add to Queue (§8.2): at the end, in both orders (§8.5). */
export function addToQueue(q: Queue, paths: readonly string[]): Queue {
  if (paths.length === 0) return q;
  const items = [...q.items, ...paths];
  if (!q.rank) return { ...q, items };
  const top = q.rank.length > 0 ? Math.max(...q.rank) : -1;
  return { ...q, items, rank: [...q.rank, ...paths.map((_, i) => top + 1 + i)] };
}

/** Takes out the entries at `indexes` (§8.4: Delete or the row's ×). The playing entry stays. */
export function removeAt(q: Queue, indexes: readonly number[]): Queue {
  const drop = new Set(indexes.filter((i) => i !== q.index && i >= 0 && i < q.items.length));
  if (drop.size === 0) return q;
  const keep = (_: unknown, i: number) => !drop.has(i);
  const before = [...drop].filter((i) => i < q.index).length;
  return {
    ...q,
    items: q.items.filter(keep),
    index: q.index < 0 ? -1 : q.index - before,
    rank: q.rank ? q.rank.filter(keep) : null,
  };
}

/** Clear (§8.4): empties Up Next. */
export function clearUpNext(q: Queue): Queue {
  return removeAt(
    q,
    q.items.map((_, i) => i).filter((i) => i > q.index),
  );
}

/**
 * Dragging an Up Next entry from `from` to `to` (indexes in `items`; `to` is where it lands once it has left
 * `from`). Only Up Next moves: the playing entry and what came before stay put.
 */
export function move(q: Queue, from: number, to: number): Queue {
  const n = q.items.length;
  if (from <= q.index || from >= n) return q;
  const target = Math.max(q.index + 1, Math.min(to, n - 1));
  if (target === from) return q;
  const shift = <T>(list: readonly T[]): T[] => {
    const out = [...list];
    const [moved] = out.splice(from, 1);
    out.splice(target, 0, moved!);
    return out;
  };
  return { ...q, items: shift(q.items), rank: q.rank ? shift(q.rank) : null };
}

/** Shuffle (⌘S, §8.5): on shuffles what comes after the playing song; off puts the original order back. */
export function setShuffle(q: Queue, on: boolean, seed: number): Queue {
  if (on === isShuffled(q)) return q;
  if (on) return shuffleAfterCurrent(q, seed);
  const rank = q.rank!;
  const order = q.items.map((_, i) => i).sort((a, b) => rank[a]! - rank[b]!);
  return {
    ...q,
    items: order.map((i) => q.items[i]!),
    index: q.index < 0 ? -1 : order.indexOf(q.index),
    rank: null,
  };
}

function shuffleAfterCurrent(q: Queue, seed: number): Queue {
  const head = q.index + 1;
  const ranks = q.items.map((_, i) => i);
  const order = [...ranks.slice(0, head), ...shuffled(ranks.slice(head), seed)];
  return { ...q, items: order.map((i) => q.items[i]!), rank: order };
}

const REPEAT_ORDER: readonly Repeat[] = ['off', 'all', 'one'];

/** Repeat (⌥⌘R): Off → All → One (§8.5). */
export function cycleRepeat(q: Queue): Queue {
  return { ...q, repeat: REPEAT_ORDER[(REPEAT_ORDER.indexOf(q.repeat) + 1) % REPEAT_ORDER.length]! };
}

/** Drops songs that are no longer in the library, keeping the playing one where it can. */
export function prune(q: Queue, exists: (path: string) => boolean): Queue {
  const gone = new Set(q.items.flatMap((p, i) => (exists(p) ? [] : [i])));
  if (gone.size === 0) return q;
  const keep = (_: unknown, i: number) => !gone.has(i);
  const items = q.items.filter(keep);
  if (items.length === 0) return { ...EMPTY_QUEUE, repeat: q.repeat };
  const before = [...gone].filter((i) => i < q.index).length;
  return {
    ...q,
    items,
    index: q.index < 0 ? -1 : Math.min(q.index - before, items.length - 1),
    rank: q.rank ? q.rank.filter(keep) : null,
  };
}

/** A seeded random number generator (mulberry32): the same seed shuffles the same way, so tests can pin one. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seed. */
export function shuffled<T>(list: readonly T[], seed: number): T[] {
  const out = [...list];
  const roll = random(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(roll() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** What is kept between runs (§8.4): the queue with shuffle and repeat, and where in the song. */
export interface SavedQueue {
  readonly format: 1;
  /** The music folder it belongs to. */
  readonly root: string;
  readonly queue: Queue;
  /** Seconds into the playing song. */
  readonly position: number;
}

export function saveQueue(root: string, queue: Queue, position: number): SavedQueue {
  return { format: 1, root, queue, position: Math.max(0, position) };
}

const isRepeat = (v: unknown): v is Repeat => REPEAT_ORDER.includes(v as Repeat);

/** Reads back a saved queue for `root`; anything wrong, or a queue for another folder, gives null. */
export function parseSavedQueue(text: string, root: string): SavedQueue | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (o.format !== 1 || o.root !== root || typeof o.position !== 'number' || !(o.position >= 0)) return null;
  const q = (typeof o.queue === 'object' && o.queue !== null ? o.queue : {}) as Record<string, unknown>;
  const { items, index, repeat, rank } = q;
  if (!Array.isArray(items) || !items.every((p) => typeof p === 'string')) return null;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < -1 || index >= items.length)
    return null;
  if (!isRepeat(repeat)) return null;
  const rankOk =
    rank === null ||
    (Array.isArray(rank) &&
      rank.length === items.length &&
      rank.every((r) => typeof r === 'number' && Number.isFinite(r)));
  if (!rankOk) return null;
  return {
    format: 1,
    root,
    position: o.position,
    queue: { items: items as string[], index, repeat, rank: rank as number[] | null },
  };
}
