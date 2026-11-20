import { useState } from 'preact/hooks';
import { formatTime, Icon, type CommandCatalog } from '@playlark/ui';
import type { AppController } from './controller.ts';

const entryId = (at: number) => `pl-queue-${at}`;

/**
 * The queue (PRD §8.4): what's playing and Up Next. Up Next rows are a list with its own cursor: ↑ ↓ move it,
 * Delete (through the command catalog) or a row's × removes, a drag reorders, a double-click or Return plays.
 */
export function QueuePanel({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const player = app.player;
  const queue = player.queue.value;
  const byPath = app.byPath.value;
  const cursor = app.queueCursor.value;
  const now = queue.index >= 0 ? queue.items[queue.index] : undefined;
  const first = queue.index + 1;
  const upNext = queue.items.slice(first);
  /** The entry being dragged, and the gap it would drop into (an index in the queue). */
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const select = (at: number | null) => {
    app.queueCursor.value = at;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || app.blocked() || upNext.length === 0) return;
    const last = queue.items.length - 1;
    const at = cursor ?? first - 1;
    let to: number;
    if (e.key === 'ArrowDown') to = Math.min(last, at + 1);
    else if (e.key === 'ArrowUp') to = Math.max(first, at - 1);
    else if (e.key === 'Home') to = first;
    else if (e.key === 'End') to = last;
    else if (e.key === 'Enter' && cursor !== null) {
      e.preventDefault();
      void player.jumpTo(cursor);
      return;
    } else return;
    e.preventDefault();
    select(to);
  };
  const title = (path: string) => byPath.get(path)?.title ?? path;

  const nowRow = (path: string) => {
    const s = byPath.get(path);
    return (
      <div class="pl-queue-row pl-playing">
        <span class="pl-queue-title">{s?.title ?? path}</span>
        <span class="pl-queue-artist">{s?.artist ?? ''}</span>
        <span class="pl-queue-time">{s ? formatTime(s.duration) : ''}</span>
      </div>
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
          {nowRow(now)}
          <div class="pl-queue-head">
            <h3>Up Next</h3>
            {upNext.length > 0 && (
              <button
                type="button"
                class="pl-link-button"
                title={catalog.get('queue.clear')!.description}
                onClick={() => catalog.run('queue.clear')}
              >
                Clear
              </button>
            )}
          </div>
          {upNext.length === 0 ? (
            <p class="pl-queue-empty">Nothing after this song.</p>
          ) : (
            <ul
              class="pl-queue-list"
              role="listbox"
              aria-label="Up Next"
              tabIndex={0}
              aria-activedescendant={cursor !== null ? entryId(cursor) : undefined}
              onKeyDown={onKeyDown}
              onFocus={() => {
                app.queueFocused.value = true;
                if (cursor === null || cursor < first) select(first);
              }}
              onBlur={() => {
                app.queueFocused.value = false;
              }}
            >
              {upNext.map((path, i) => {
                const at = first + i;
                const classes = [
                  at === cursor ? 'pl-cursor' : '',
                  drag && drag.from !== at && drag.to === at ? 'pl-drop-before' : '',
                  drag && drag.to === queue.items.length && at === queue.items.length - 1
                    ? 'pl-drop-after'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                const s = byPath.get(path);
                return (
                  <li
                    key={`${at}:${path}`}
                    id={entryId(at)}
                    role="option"
                    aria-selected={at === cursor}
                    class={`pl-queue-row ${classes}`}
                    draggable
                    onMouseDown={() => select(at)}
                    onDblClick={() => void player.jumpTo(at)}
                    onDragStart={(e) => {
                      e.dataTransfer?.setData('text/plain', title(path));
                      setDrag({ from: at, to: at });
                    }}
                    onDragOver={(e) => {
                      if (!drag) return;
                      e.preventDefault();
                      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const to = e.clientY > box.top + box.height / 2 ? at + 1 : at;
                      if (to !== drag.to) setDrag({ ...drag, to });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!drag) return;
                      // `to` is a gap before the move; once the entry has left `from`, the gaps after it shift up.
                      const to = drag.to > drag.from ? drag.to - 1 : drag.to;
                      player.move(drag.from, to);
                      select(to);
                      setDrag(null);
                    }}
                    onDragEnd={() => setDrag(null)}
                  >
                    <span class="pl-queue-title">{s?.title ?? path}</span>
                    <span class="pl-queue-artist">{s?.artist ?? ''}</span>
                    <span class="pl-queue-time">{s ? formatTime(s.duration) : ''}</span>
                    <button
                      type="button"
                      class="pl-queue-remove"
                      tabIndex={-1}
                      aria-label={`Remove ${title(path)}`}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => player.remove([at])}
                    >
                      <Icon name="x" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}
