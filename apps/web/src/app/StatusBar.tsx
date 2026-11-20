import { formatCount, Icon } from '@playlark/ui';
import type { AppController } from './controller.ts';

/** The status bar (PRD §6.1): the latest notice, the scan, the song count and the folder's name. */
export function StatusBar({ app }: { readonly app: AppController }) {
  const notice = app.notice.value;
  const source = app.source.value;
  const scanning = app.scanning.value;
  const count = app.songs.value.length;
  return (
    <footer class="pl-status">
      <div class={`pl-notice${notice?.tone === 'error' ? ' pl-notice-error' : ''}`}>
        {notice && (
          <>
            <span>{notice.text}</span>
            {notice.action && (
              <button
                type="button"
                class="pl-link-button"
                onClick={() => {
                  const run = notice.action!.run;
                  app.dismissNotice();
                  run();
                }}
              >
                {notice.action.label}
              </button>
            )}
            {notice.sticky && (
              <button
                type="button"
                class="pl-icon-button pl-small"
                aria-label="Dismiss"
                onClick={() => app.dismissNotice()}
              >
                <Icon name="x" />
              </button>
            )}
          </>
        )}
      </div>
      {scanning && scanning.total > 0 && (
        <span class="pl-where">
          Scanning {formatCount(scanning.done)} of {formatCount(scanning.total)}
        </span>
      )}
      {source && app.scanned.value && (
        <span class="pl-where">{count === 1 ? '1 song' : `${formatCount(count)} songs`}</span>
      )}
      {source && (
        <span class="pl-where" title={source.where ?? source.name}>
          {source.name}
        </span>
      )}
      <div class="pl-live" role="status" aria-live="polite" aria-atomic="true">
        {app.announcement.value}
      </div>
    </footer>
  );
}
