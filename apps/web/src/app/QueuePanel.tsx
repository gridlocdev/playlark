import { formatTime } from '@playlark/ui';
import type { AppController } from './controller.ts';

/** The queue (PRD §8.4): what's playing and what comes next. Click a song to jump to it. */
export function QueuePanel({ app }: { readonly app: AppController }) {
  const queue = app.player.queue.value;
  const byPath = app.byPath.value;
  const upNext = queue.items.slice(queue.index + 1);
  const now = queue.index >= 0 ? queue.items[queue.index] : undefined;
  const row = (path: string, at: number, playing: boolean) => {
    const s = byPath.get(path);
    return (
      <li key={`${at}:${path}`} class={playing ? 'pl-playing' : undefined}>
        <button type="button" onClick={() => void app.player.jumpTo(at)}>
          <span class="pl-queue-title">{s?.title ?? path}</span>
          <span class="pl-queue-artist">{s?.artist ?? ''}</span>
          <span class="pl-queue-time">{s ? formatTime(s.duration) : ''}</span>
        </button>
      </li>
    );
  };
  return (
    <aside class="pl-queue" aria-label="Queue">
      <h2>Queue</h2>
      {now === undefined ? (
        <p class="pl-queue-empty">Nothing is playing. Double-click a song to play the list from there.</p>
      ) : (
        <>
          <h3>Now Playing</h3>
          <ul>{row(now, queue.index, true)}</ul>
          <h3>Up Next</h3>
          {upNext.length === 0 ? (
            <p class="pl-queue-empty">Nothing after this song.</p>
          ) : (
            <ul>{upNext.map((p, i) => row(p, queue.index + 1 + i, false))}</ul>
          )}
        </>
      )}
    </aside>
  );
}
