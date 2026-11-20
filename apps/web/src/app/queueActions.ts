/** Play Next, Add to Queue and Delete in the queue panel (PRD §8.2, §8.4), with their notices. */
import type { Song } from '@playlark/core';
import { formatCount } from '@playlark/ui';
import type { AppController } from './controller.ts';

/** Play Next (§8.2): right after the playing song, without interrupting it. */
export function playNext(app: AppController, songs: readonly Song[]): void {
  const playable = songs.filter((s) => !s.error);
  if (playable.length === 0) return;
  app.player.playNext(playable.map((s) => s.path));
  app.say(
    playable.length === 1
      ? `Playing next: ${playable[0]!.title}`
      : `Playing next: ${formatCount(playable.length)} songs`,
  );
}

/** Add to Queue (§8.2): at the end. */
export function addToQueue(app: AppController, songs: readonly Song[]): void {
  const playable = songs.filter((s) => !s.error);
  if (playable.length === 0) return;
  app.player.addToQueue(playable.map((s) => s.path));
  app.say(
    playable.length === 1
      ? `Added ${playable[0]!.title} to the queue.`
      : `Added ${formatCount(playable.length)} songs to the queue.`,
  );
}

/** Delete in the queue panel: takes out the entry under its cursor; the cursor stays on the one after (§8.4). */
export function removeFromQueue(app: AppController): void {
  const at = app.queueCursor.peek();
  if (at === null) return;
  app.player.remove([at]);
  const q = app.player.queue.peek();
  app.queueCursor.value =
    at < q.items.length && at > q.index ? at : q.items.length - 1 > q.index ? q.items.length - 1 : null;
}
