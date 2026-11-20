import { useRef } from 'preact/hooks';
import type { Song, SongColumn } from '@playlark/core';
import { formatTime, useVirtualRows } from '@playlark/ui';
import type { AppController } from './controller.ts';
import { PlayingMark } from './PlayingMark.tsx';
import { click, step } from './selection.ts';

/** Each row's height in px: the list draws only the rows in view (PRD §6.1), so every row is the same height. */
export const ROW_HEIGHT = 28;
/** The header row's height in px. */
export const HEADER_HEIGHT = 29;

export type Column = SongColumn | 'track';

const TITLES: Record<Column, string> = {
  track: '#',
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  time: 'Time',
};

/** One line of the list: a song, or the heading over a disc's songs (§6.2 album page). */
type Line = { readonly song: Song; readonly index: number } | { readonly disc: number };

const rowId = (path: string) => `pl-row-${encodeURIComponent(path)}`;

/**
 * A list of songs with the view's selection (PRD §6.2, §6.3). The rows are `app.rows`, so Play, the keys and
 * Select All act on exactly what is shown.
 */
export function SongList({
  app,
  label,
  columns,
  sortable = false,
  discs = false,
}: {
  readonly app: AppController;
  readonly label: string;
  readonly columns: readonly Column[];
  /** Clicking a header sorts by it (the Songs view). */
  readonly sortable?: boolean;
  /** Heads each disc's songs with its number. */
  readonly discs?: boolean;
}) {
  const songs = app.rows.value;
  const paths = app.rowPaths.value;
  const selection = app.selection.value;
  const playing = app.player.currentPath.value;
  const state = app.player.state.value;
  const order = app.songOrder.value;
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLTableElement>(null);

  const lines: Line[] = [];
  let disc: number | null = null;
  songs.forEach((song, index) => {
    if (discs && (song.disc ?? 1) !== disc) {
      disc = song.disc ?? 1;
      lines.push({ disc });
    }
    lines.push({ song, index });
  });
  const focusLine =
    selection.cursor === null ? -1 : lines.findIndex((l) => 'song' in l && l.song.path === selection.cursor);
  const { start, end } = useVirtualRows(scroller, lines.length, ROW_HEIGHT, focusLine, HEADER_HEIGHT);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || app.blocked()) return;
    const next = step(selection, paths, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    app.selection.value = next;
  };
  const pick = (e: MouseEvent, path: string) => {
    const how = e.shiftKey ? 'extend' : e.metaKey || e.ctrlKey ? 'toggle' : 'only';
    app.selection.value = click(selection, paths, path, how);
    grid.current?.focus();
  };
  const span = columns.length + 1;

  return (
    <div class="pl-songs-scroll" ref={scroller}>
      <table
        ref={grid}
        class="pl-songs"
        role="grid"
        aria-label={label}
        aria-rowcount={lines.length + 1}
        aria-multiselectable="true"
        tabIndex={0}
        aria-activedescendant={selection.cursor !== null ? rowId(selection.cursor) : undefined}
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr aria-rowindex={1}>
            <th class="pl-col-mark" aria-label="Playing" />
            {columns.map((c) => {
              const sorted = sortable && order.column === c;
              return (
                <th
                  key={c}
                  class={`pl-col-${c}`}
                  aria-sort={sorted ? (order.reverse ? 'descending' : 'ascending') : undefined}
                >
                  {sortable && c !== 'track' ? (
                    <button type="button" class="pl-sort" onClick={() => app.sortBy(c)}>
                      {TITLES[c]}
                      {sorted && <span aria-hidden="true">{order.reverse ? ' ▾' : ' ▴'}</span>}
                    </button>
                  ) : (
                    TITLES[c]
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {start > 0 && (
            <tr class="pl-spacer" style={{ height: `${start * ROW_HEIGHT}px` }} aria-hidden="true" />
          )}
          {lines.slice(start, end).map((line, i) =>
            'disc' in line ? (
              <tr key={`disc-${line.disc}`} class="pl-disc" aria-rowindex={start + i + 2}>
                <td colSpan={span}>Disc {line.disc}</td>
              </tr>
            ) : (
              <SongRow
                key={line.song.path}
                song={line.song}
                rowIndex={start + i + 2}
                stripe={line.index % 2 === 1}
                columns={columns}
                selected={selection.paths.has(line.song.path)}
                playing={line.song.path === playing ? state : null}
                onPick={(e) => pick(e, line.song.path)}
                onPlay={() => void app.playPath(line.song.path)}
              />
            ),
          )}
          {end < lines.length && (
            <tr
              class="pl-spacer"
              style={{ height: `${(lines.length - end) * ROW_HEIGHT}px` }}
              aria-hidden="true"
            />
          )}
        </tbody>
      </table>
    </div>
  );
}

function cell(song: Song, column: Column): string {
  switch (column) {
    case 'track':
      return song.track === undefined ? '' : String(song.track);
    case 'title':
      return song.title;
    case 'artist':
      return song.artist;
    case 'album':
      return song.album;
    case 'time':
      return song.error ? '' : formatTime(song.duration);
  }
}

function SongRow(props: {
  readonly song: Song;
  readonly rowIndex: number;
  readonly stripe: boolean;
  readonly columns: readonly Column[];
  readonly selected: boolean;
  /** The player's state when this is the playing song. */
  readonly playing: string | null;
  readonly onPick: (e: MouseEvent) => void;
  readonly onPlay: () => void;
}) {
  const { song: s } = props;
  const classes = [
    s.error ? 'pl-unreadable' : '',
    props.playing ? 'pl-playing' : '',
    props.stripe ? 'pl-stripe' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <tr
      id={rowId(s.path)}
      role="row"
      aria-rowindex={props.rowIndex}
      aria-selected={props.selected}
      class={classes || undefined}
      title={s.error ? `Can’t read this file: ${s.error}` : s.path}
      onMouseDown={(e) => {
        // Keep focus on the table, so the keys keep working after a click.
        e.preventDefault();
        props.onPick(e);
      }}
      onDblClick={() => !s.error && props.onPlay()}
    >
      <td class="pl-col-mark">{props.playing && <PlayingMark moving={props.playing === 'playing'} />}</td>
      {props.columns.map((c) => (
        <td key={c} class={`pl-col-${c}`}>
          {cell(s, c)}
        </td>
      ))}
    </tr>
  );
}
