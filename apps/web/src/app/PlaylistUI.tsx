/**
 * The playlists in the window (PRD §9): the sidebar's list, which takes dropped songs and renames in place; the
 * Add to Playlist picker; and the dialog for a playlist changed somewhere else.
 */
import { useRef, useState } from 'preact/hooks';
import { Dialog, Icon, ListPopup, PopupMenu, filterEntries, type CommandCatalog } from '@playlark/ui';
import type { AppController } from './controller.ts';
import { PLAYLIST_MENU } from './playlistCommands.ts';
import { NEW_PLAYLIST, type PlaylistInfo } from './playlists.ts';
import { SONGS_TYPE } from './SongList.tsx';

/** The song paths a drag from the song list carries, or null for any other drag. */
function droppedSongs(e: DragEvent): string[] | null {
  const data = e.dataTransfer?.getData(SONGS_TYPE);
  if (!data) return null;
  const paths: unknown = JSON.parse(data);
  return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : null;
}

const carriesSongs = (e: DragEvent) => !!e.dataTransfer?.types.includes(SONGS_TYPE);

/** The sidebar's Playlists section (§6.1), alphabetical. */
export function SidebarPlaylists({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const list = app.playlists.list.value;
  const view = app.view.value;
  const [menu, setMenu] = useState<{ readonly x: number; readonly y: number } | null>(null);
  if (list.length === 0 && !app.playlists.editable.value) return null;
  const make = catalog.get('playlist.new');
  const keys = make ? catalog.keys(make).join('') : '';
  return (
    <>
      <h2 class="pl-sidebar-title">Playlists</h2>
      <ul aria-label="Playlists">
        {list.map((p) => (
          <SidebarPlaylist
            key={p.path}
            app={app}
            playlist={p}
            current={view.kind === 'playlist' && view.path === p.path}
            onMenu={(e) => {
              app.playlists.target.value = p.path;
              setMenu({ x: e.clientX, y: e.clientY });
            }}
          />
        ))}
        {list.length === 0 && (
          <li class="pl-sidebar-none">No playlists yet.{keys && ` ${keys} makes one.`}</li>
        )}
      </ul>
      {menu && (
        <PopupMenu
          label="Playlist"
          catalog={catalog}
          items={PLAYLIST_MENU}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            setMenu(null);
            // After the command has read it.
            queueMicrotask(() => {
              app.playlists.target.value = null;
            });
          }}
        />
      )}
    </>
  );
}

function SidebarPlaylist({
  app,
  playlist,
  current,
  onMenu,
}: {
  readonly app: AppController;
  readonly playlist: PlaylistInfo;
  readonly current: boolean;
  readonly onMenu: (e: MouseEvent) => void;
}) {
  const [over, setOver] = useState(false);
  if (app.playlists.renaming.value === playlist.path)
    return (
      <li>
        <RenameField app={app} playlist={playlist} />
      </li>
    );
  const editable = app.playlists.editable.value;
  return (
    <li>
      <button
        type="button"
        class={over ? 'pl-drop-target' : undefined}
        aria-current={current ? 'page' : undefined}
        title={playlist.path}
        onClick={() => app.navigate({ kind: 'playlist', path: playlist.path })}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e);
        }}
        onDragOver={(e) => {
          if (!editable || !carriesSongs(e)) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const songs = droppedSongs(e);
          if (!songs) return;
          e.preventDefault();
          void app.playlists.add(playlist.path, songs);
        }}
      >
        <Icon name="list-music" /> <span class="pl-sidebar-name">{playlist.name}</span>
      </button>
    </li>
  );
}

/** The name field in place of a playlist's entry (§9.2): Return renames, Escape or leaving it keeps the name. */
function RenameField({ app, playlist }: { readonly app: AppController; readonly playlist: PlaylistInfo }) {
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    if (name === null || name.trim() === '' || name.trim() === playlist.name)
      app.playlists.renaming.value = null;
    else void app.playlists.rename(playlist.path, name.trim());
  };
  return (
    <input
      class="pl-rename"
      aria-label={`Name of ${playlist.name}`}
      value={playlist.name}
      ref={(el) => {
        if (el && !el.dataset.focused) {
          el.dataset.focused = '1';
          el.focus();
          el.select();
        }
      }}
      onKeyDown={(e) => {
        if (e.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

/** Add to Playlist… (§9.2): pick a playlist by typing, or New Playlist, for the selected songs. */
export function AddToPlaylistDialog({ app }: { readonly app: AppController }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const entries = [
    { id: '', title: `${NEW_PLAYLIST}…`, group: '' },
    ...app.playlists.list.value.map((p) => ({ id: p.path, title: p.name, group: p.path })),
  ];
  const results = query ? filterEntries(entries, query, []) : entries;
  const pick = (i: number) => {
    const entry = results[i];
    if (!entry) return;
    const songs = app.selectedSongs().map((s) => s.path);
    app.close();
    queueMicrotask(() => {
      if (entry.id) void app.playlists.add(entry.id, songs);
      else
        void app.playlists.create(songs).then((path) => {
          if (path) app.sidebarShown.value = true;
        });
    });
  };
  return (
    <ListPopup
      label="Add to playlist"
      placeholder="Add to playlist…"
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
          onPointerMove={() => setIndex(i)}
          onClick={() => pick(i)}
        >
          <span class="pl-palette-title">{e.title}</span>
          {e.group && <span class="pl-palette-group">{e.group}</span>}
        </li>
      ))}
    </ListPopup>
  );
}

/** "<Playlist> changed somewhere else" (§9.3): nothing is written until the user picks. */
export function ConflictDialog({ app, path }: { readonly app: AppController; readonly path: string }) {
  const name = app.playlists.nameOf(path);
  // Escape leaves both as they are; the next edit or check asks again.
  const later = () => {
    app.playlists.conflict.value = null;
  };
  return (
    <Dialog
      title={`${name} changed somewhere else`}
      onClose={later}
      actions={
        <>
          <button type="button" class="pl-button" onClick={() => void app.playlists.useTheirs()}>
            Use Theirs
          </button>
          <button
            type="button"
            class="pl-button pl-button-primary"
            onClick={() => void app.playlists.keepMine()}
          >
            Keep Mine
          </button>
        </>
      }
    >
      <p>
        Another app or another Playlark changed {name} while you were editing it here. Keep Mine writes your
        playlist over theirs; Use Theirs takes their changes (Undo brings yours back).
      </p>
    </Dialog>
  );
}
