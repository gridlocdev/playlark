/** The narrow layout's parts (PRD §18.5): the bottom tab bar and the Playlists page it opens. */
import { Icon, type CommandCatalog } from '@playlark/ui';
import type { AppController } from './controller.ts';
import { SidebarCollections } from './Collections.tsx';
import { SidebarPlaylists } from './PlaylistUI.tsx';
import type { View } from './views.ts';

type Tab = 'songs' | 'albums' | 'artists' | 'playlists' | 'search';

const TABS: readonly { readonly tab: Tab; readonly label: string; readonly icon: string }[] = [
  { tab: 'songs', label: 'Songs', icon: 'list' },
  { tab: 'albums', label: 'Albums', icon: 'layout-grid' },
  { tab: 'artists', label: 'Artists', icon: 'music' },
  { tab: 'playlists', label: 'Playlists', icon: 'list-music' },
  { tab: 'search', label: 'Search', icon: 'search' },
];

/** The tab a view belongs to, or null (Folders has no tab). */
export function tabOf(view: View): Tab | null {
  switch (view.kind) {
    case 'songs':
    case 'search':
    case 'playlists':
      return view.kind;
    case 'albums':
    case 'album':
      return 'albums';
    case 'artists':
    case 'artist':
      return 'artists';
    case 'playlist':
    case 'favourites':
    case 'recent':
    case 'mostPlayed':
      return 'playlists';
    case 'folders':
      return null;
  }
}

/** The bottom tab bar, shown in place of the sidebar below 700 px. */
export function PhoneTabs({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const current = tabOf(app.view.value);
  const open = (tab: Tab) => {
    if (tab === 'search') return catalog.run('edit.find');
    app.navigate(
      tab === 'songs'
        ? { kind: 'songs' }
        : tab === 'albums'
          ? { kind: 'albums' }
          : tab === 'artists'
            ? { kind: 'artists' }
            : { kind: 'playlists' },
    );
  };
  return (
    <nav class="pl-tabs" aria-label="Tabs">
      {TABS.map((t) => (
        <button
          key={t.tab}
          type="button"
          aria-current={current === t.tab ? 'page' : undefined}
          onClick={() => open(t.tab)}
        >
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** The collections and playlists as a page, as the sidebar lists them. */
export function PlaylistsPage({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  return (
    <nav class="pl-sidebar pl-playlists-page" aria-label="Playlists">
      <SidebarCollections app={app} current="playlists" />
      <SidebarPlaylists app={app} catalog={catalog} />
    </nav>
  );
}
