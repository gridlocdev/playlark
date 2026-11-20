import { useRef } from 'preact/hooks';
import { formatCount, formatTime, Icon, useScrolledIntoView } from '@playlark/ui';
import type { Song } from '@playlark/core';
import type { CommandCatalog } from '@playlark/ui';
import type { AppController } from './controller.ts';
import { cursorStep } from './cursor.ts';

const rowId = (i: number) => `pl-song-${i}`;

/** The Songs view (PRD §6.2): every song in the folder, the playing one marked. */
export function SongsTable({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const songs = app.songs.value;
  const cursor = app.cursor.value;
  const playing = app.player.currentPath.value;
  const grid = useRef<HTMLTableElement>(null);
  const index = cursor === null ? -1 : songs.findIndex((s) => s.path === cursor);

  useScrolledIntoView(grid, index >= 0 ? rowId(index) : null);

  const empty = emptyText(app);
  if (empty)
    return (
      <div class="pl-empty">
        <p>{empty}</p>
        {!app.source.value && app.folders && (
          <button
            type="button"
            class="pl-button pl-button-primary"
            onClick={() => catalog.run('file.openFolder')}
          >
            Open Music Folder…
          </button>
        )}
      </div>
    );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || app.blocked()) return;
    const next = cursorStep(e.key, index, songs.length);
    if (next === undefined) return;
    e.preventDefault();
    app.cursor.value = songs[next]!.path;
  };

  return (
    <div class="pl-songs-scroll">
      <table
        ref={grid}
        class="pl-songs"
        role="grid"
        aria-label="Songs"
        aria-rowcount={songs.length + 1}
        tabIndex={0}
        aria-activedescendant={index >= 0 ? rowId(index) : undefined}
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            <th class="pl-col-mark" aria-label="Playing" />
            <th>Title</th>
            <th>Artist</th>
            <th>Album</th>
            <th class="pl-col-time">Time</th>
          </tr>
        </thead>
        <tbody>
          {songs.map((s, i) => (
            <SongRow
              key={s.path}
              song={s}
              id={rowId(i)}
              selected={i === index}
              playing={s.path === playing}
              state={app.player.state.value}
              onPick={() => {
                app.cursor.value = s.path;
                grid.current?.focus();
              }}
              onPlay={() => {
                app.cursor.value = s.path;
                catalog.run('song.play');
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SongRow(props: {
  readonly song: Song;
  readonly id: string;
  readonly selected: boolean;
  readonly playing: boolean;
  readonly state: string;
  readonly onPick: () => void;
  readonly onPlay: () => void;
}) {
  const { song: s } = props;
  const classes = [s.error ? 'pl-unreadable' : '', props.playing ? 'pl-playing' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <tr
      id={props.id}
      role="row"
      aria-selected={props.selected}
      class={classes || undefined}
      title={s.error ? `Can’t read this file: ${s.error}` : s.path}
      onMouseDown={(e) => {
        // Keep focus on the table, so the keys keep working after a click.
        e.preventDefault();
        props.onPick();
      }}
      onDblClick={() => !s.error && props.onPlay()}
    >
      <td class="pl-col-mark">
        {props.playing && <Icon name={props.state === 'playing' ? 'volume' : 'music'} title="Playing" />}
      </td>
      <td>{s.title}</td>
      <td>{s.artist}</td>
      <td>{s.album}</td>
      <td class="pl-col-time">{s.error ? '' : formatTime(s.duration)}</td>
    </tr>
  );
}

/** The empty states (§6.2, §17), or null when there are songs to show. */
function emptyText(app: AppController): string | null {
  const source = app.source.value;
  if (!source) return app.cannotOpen ?? 'Choose a music folder to start.';
  if (app.songs.value.length > 0) return null;
  if (!app.scanned.value) {
    const p = app.scanning.value;
    return p && p.total > 0
      ? `Reading ${formatCount(p.done)} of ${formatCount(p.total)} files…`
      : 'Reading the music folder…';
  }
  return `No music found in ${source.name}. Playlark plays MP3, FLAC, M4A, Ogg and WAV files.`;
}
