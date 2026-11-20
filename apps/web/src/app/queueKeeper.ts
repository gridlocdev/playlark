/** Keeps the play queue between runs, per music folder, and puts it back paused (PRD §8.4). */
import { saveQueue } from '@playlark/core';
import { formatCount, type IndexStore, type Player } from '@playlark/ui';

/** A playing queue is kept again once its position has moved this far. */
export const QUEUE_SAVE_MS = 5_000;

/** The notice when songs in the queue are no longer in the folder. */
export function goneNotice(gone: number): string {
  return gone === 1
    ? '1 song in your queue is gone and was removed.'
    : `${formatCount(gone)} songs in your queue are gone and were removed.`;
}

export interface QueueKeeperOptions {
  readonly index: IndexStore | undefined;
  readonly player: Player;
  readonly say: (text: string, tone?: 'error') => void;
}

export class QueueKeeper {
  readonly #options: QueueKeeperOptions;
  /** The queue as last kept, and the position kept with it. */
  #kept: { root: string; queue: unknown; position: number } | null = null;
  /** The open folder's saved queue has been put back (or there was none). */
  #restored = false;

  constructor(options: QueueKeeperOptions) {
    this.#options = options;
  }

  /** A new folder is open: its queue is put back on the next `restore`. */
  reset(): void {
    this.#restored = false;
    this.#kept = null;
  }

  /**
   * Puts back the queue kept for `root`, paused, once per folder. `stillOpen` says whether that folder is still
   * the open one once the queue has been read.
   */
  async restore(root: string, stillOpen: () => boolean): Promise<void> {
    if (this.#restored) return;
    this.#restored = true;
    const { index, player, say } = this.#options;
    let saved;
    try {
      saved = (await index?.loadQueue(root)) ?? null;
    } catch {
      // A queue that can't be read starts empty, like a first run.
      saved = null;
    }
    if (!saved || !stillOpen() || player.state.peek() !== 'stopped') return;
    const gone = player.restore(saved);
    this.#kept = { root: saved.root, queue: player.queue.peek(), position: saved.position };
    if (gone > 0) say(goneNotice(gone));
  }

  /** Keeps the queue for `root` when it changed, or when it's playing and has moved on QUEUE_SAVE_MS. */
  async keep(root: string): Promise<void> {
    const { index, player, say } = this.#options;
    if (!index || !this.#restored) return;
    const queue = player.queue.peek();
    const position = player.position.peek();
    const kept = this.#kept;
    const moved = kept !== null && Math.abs(position - kept.position) * 1000 >= QUEUE_SAVE_MS;
    if (kept?.root === root && kept.queue === queue && !moved) return;
    this.#kept = { root, queue, position };
    try {
      await index.saveQueue(saveQueue(root, queue, position));
    } catch (e) {
      say(`Couldn’t keep the queue: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }
}
