import { Icon, PopupMenu, type CommandCatalog } from '@playlark/ui';
import { SONG_MENU } from './commands.ts';
import type { AppController } from './controller.ts';
import { Dialogs } from './Dialogs.tsx';
import { NowPlaying } from './NowPlaying.tsx';
import { QueuePanel } from './QueuePanel.tsx';
import { StatusBar } from './StatusBar.tsx';
import { CurrentView, viewTitle } from './Pages.tsx';
import type { View } from './views.ts';

const LIBRARY: readonly { readonly label: string; readonly icon: string; readonly view: View }[] = [
  { label: 'Songs', icon: 'list', view: { kind: 'songs' } },
  { label: 'Albums', icon: 'layout-grid', view: { kind: 'albums' } },
  { label: 'Artists', icon: 'music', view: { kind: 'artists' } },
  { label: 'Folders', icon: 'folder', view: { kind: 'folders', path: '' } },
];

/** The section a view belongs to, for the sidebar's highlight. */
function section(view: View): View['kind'] {
  if (view.kind === 'album') return 'albums';
  if (view.kind === 'artist') return 'artists';
  return view.kind;
}

/** The window (PRD §6.1): sidebar, toolbar with search, the view and the queue, now playing, status bar. */
export function App({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  const view = app.view.value;
  const history = app.history.value;
  const current = section(view);
  return (
    <div class="pl-app">
      <header class="pl-toolbar">
        <div class="pl-nav-buttons">
          <button
            type="button"
            class="pl-icon-button"
            aria-label="Back"
            title="Back"
            disabled={history.back.length === 0}
            onClick={() => catalog.run('view.back')}
          >
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            class="pl-icon-button"
            aria-label="Forward"
            title="Forward"
            disabled={history.forward.length === 0}
            onClick={() => catalog.run('view.forward')}
          >
            <Icon name="chevron-right" />
          </button>
        </div>
        <h1 class="pl-view-title">{viewTitle(app, view)}</h1>
        <label class="pl-search">
          <Icon name="search" />
          <input
            ref={app.searchField}
            type="search"
            placeholder="Search"
            aria-label="Search the library"
            value={app.searchText.value}
            onInput={(e) => app.setSearch(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                app.clearSearch();
              }
            }}
          />
        </label>
      </header>
      <div class="pl-body">
        {app.sidebarShown.value && (
          <nav class="pl-sidebar" aria-label="Library">
            <h2 class="pl-sidebar-title">Library</h2>
            <ul>
              {LIBRARY.map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    aria-current={current === item.view.kind ? 'page' : undefined}
                    onClick={() => app.navigate(item.view)}
                  >
                    <Icon name={item.icon} /> {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <main class="pl-view">
          <CurrentView app={app} catalog={catalog} />
        </main>
        {app.queueShown.value && <QueuePanel app={app} catalog={catalog} />}
      </div>
      <NowPlaying app={app} catalog={catalog} />
      <StatusBar app={app} />
      <Dialogs app={app} catalog={catalog} />
      {app.menu.value && (
        <PopupMenu
          label="Song"
          catalog={catalog}
          items={SONG_MENU}
          x={app.menu.value.x}
          y={app.menu.value.y}
          onClose={() => {
            app.menu.value = null;
          }}
        />
      )}
    </div>
  );
}
