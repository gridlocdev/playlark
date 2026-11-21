import { useMemo, useState } from 'preact/hooks';
import { Dialog, ListPopup, filterEntries, isMac, type CommandCatalog, type MenuEntry } from '@playlark/ui';
import type { AppController } from './controller.ts';
import { AddToPlaylistDialog, ConflictDialog } from './PlaylistUI.tsx';
import { shortcutGroups } from './shortcuts.ts';
import { ChooseFolderDialog, SettingsDialog } from './SettingsUI.tsx';
import { SongInfoDialog } from './SongInfo.tsx';

/** The open dialog, if any. One at a time. */
export function Dialogs({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  // A playlist changed elsewhere comes first: nothing is saved until the user picks (§9.3).
  const conflict = app.playlists.conflict.value;
  if (conflict !== null) return <ConflictDialog app={app} path={conflict} />;
  switch (app.dialog.value) {
    case 'commands':
      return <CommandMenu app={app} catalog={catalog} />;
    case 'shortcuts':
      return <ShortcutsDialog app={app} catalog={catalog} />;
    case 'unreadable':
      return <UnreadableDialog app={app} />;
    case 'addToPlaylist':
      return <AddToPlaylistDialog app={app} />;
    case 'songInfo':
      return <SongInfoDialog app={app} />;
    case 'settings':
      return app.preferences ? <SettingsDialog app={app} prefs={app.preferences} /> : null;
    case 'chooseFolder':
      return <ChooseFolderDialog app={app} />;
    case null:
      return null;
  }
}

interface Entry extends MenuEntry {
  readonly keys: string;
  readonly enabled: boolean;
}

/** ⌘K: every command, recent ones first (PRD §14). */
function CommandMenu({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const entries = useMemo<Entry[]>(
    () =>
      catalog.all
        .filter((c) => !c.hidden && c.id !== 'help.commands')
        .map((c) => ({
          id: c.id,
          title: c.title,
          group: c.group,
          keywords: `${c.keywords ?? ''} ${c.description}`,
          keys: catalog.keys(c).join(' '),
          enabled: catalog.isEnabled(c),
        })),
    [catalog],
  );
  const results = filterEntries(entries, query, catalog.recentIds).slice(0, 80);
  const pick = (i: number) => {
    const entry = results[i];
    if (!entry?.enabled) return;
    app.close();
    // Let the menu close (and focus go back) before the command runs.
    queueMicrotask(() => catalog.run(entry.id));
  };
  return (
    <ListPopup
      label="Command menu"
      placeholder="Type a command…"
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setIndex(0);
      }}
      index={index}
      onIndex={setIndex}
      count={results.length}
      onPick={pick}
      onClose={() => app.close()}
    >
      {results.map((e, i) => (
        <li
          key={e.id}
          id={`pl-palette-${i}`}
          role="option"
          aria-selected={i === index}
          aria-disabled={!e.enabled}
          class={e.enabled ? undefined : 'pl-disabled'}
          onPointerMove={() => setIndex(i)}
          onClick={() => pick(i)}
        >
          <span class="pl-palette-title">{e.title}</span>
          <span class="pl-palette-group">{e.group}</span>
          {e.keys && <kbd>{e.keys}</kbd>}
        </li>
      ))}
    </ListPopup>
  );
}

/** ⌘/: every shortcut, made from the catalog (PRD §14). */
function ShortcutsDialog({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const groups = shortcutGroups(catalog, isMac);
  return (
    <Dialog
      title="Keyboard Shortcuts"
      class="pl-dialog-wide"
      onClose={() => app.close()}
      actions={
        <button type="button" class="pl-button pl-button-primary" onClick={() => app.close()}>
          Close
        </button>
      }
    >
      <div class="pl-shortcuts">
        {groups.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.lines.map((l) => (
                <div key={l.title} class="pl-shortcut">
                  <dt>{l.title}</dt>
                  <dd>
                    {l.keys.map((way, i) => (
                      <span key={i} class="pl-way">
                        {i > 0 && <span class="pl-or">or</span>}
                        {way.map((k, j) => (
                          <kbd key={j}>{k}</kbd>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** The files the last scan couldn't read, each with the reason (PRD §3.3). */
function UnreadableDialog({ app }: { readonly app: AppController }) {
  const files = app.songs.value.filter((s) => s.error);
  return (
    <Dialog
      title="Files That Couldn’t Be Read"
      class="pl-dialog-wide"
      onClose={() => app.close()}
      actions={
        <button type="button" class="pl-button pl-button-primary" onClick={() => app.close()}>
          Close
        </button>
      }
    >
      {files.length === 0 ? (
        <p>Every file was read.</p>
      ) : (
        <dl class="pl-unreadable-list">
          {files.map((s) => (
            <div key={s.path}>
              <dt>{s.path}</dt>
              <dd>{s.error}</dd>
            </div>
          ))}
        </dl>
      )}
    </Dialog>
  );
}
