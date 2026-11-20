import type { CommandCatalog } from '@playlark/ui';
import type { AppController } from './controller.ts';
import { Dialogs } from './Dialogs.tsx';
import { NowPlaying } from './NowPlaying.tsx';
import { QueuePanel } from './QueuePanel.tsx';
import { SongsTable } from './SongsTable.tsx';
import { StatusBar } from './StatusBar.tsx';

/** The window (PRD §6.1): the toolbar row, the song list and the queue, the now-playing bar, the status bar. */
export function App({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  return (
    <div class="pl-app">
      <header class="pl-toolbar">
        <h1 class="pl-view-title">Songs</h1>
      </header>
      <div class="pl-body">
        <main class="pl-view">
          <SongsTable app={app} catalog={catalog} />
        </main>
        {app.queueShown.value && <QueuePanel app={app} />}
      </div>
      <NowPlaying app={app} catalog={catalog} />
      <StatusBar app={app} />
      <Dialogs app={app} catalog={catalog} />
    </div>
  );
}
