import { useRef, useState } from 'preact/hooks';
import type { Song, SongColumn, SongStats } from '@playlark/core';
import { Icon, formatCount, formatTime, useVirtualRows } from '@playlark/ui';
import type { AppController } from './controller.ts';
import { PlayingMark } from './PlayingMark.tsx';
import { MISSING } from './playlists.ts';
import { click, only, step } from './selection.ts';

/** The drag data type that carries song paths, as JSON, onto a playlist in the sidebar (§9.2). */
export const SONGS_TYPE = 'application/x-playlark-songs';

/** Each row's height in px: the list draws only the rows in view (PRD §6.1), so every row is the same height. */
export const ROW_HEIGHT = 28;
/** The header row's height in px. */
export const HEADER_HEIGHT = 29;

export type Column = SongColumn | 'track';

/** The columns most lists show; the Songs view adds Plays (§6.2). */
export const LIST_COLUMNS: readonly Column[] = ['favourite', 'title', 'artist', 'album', 'time'];

const TITLES: Record<Column, string> = {
  favourite: '♥',
  plays: 'Plays',
  track: '#',
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  time: 'Time',
};

/** One line of the list: a song, or the heading over a disc's songs (§6.2 album page). */
type Line = { readonly song: Song; readonly index: number; readonly key: string } | { readonly disc: number };

const rowId = (key: string) => `pl-row-${encodeURIComponent(key)}`;

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
  onMove,
}: {
  readonly app: AppController;
  readonly label: string;
  readonly columns: readonly Column[];
  /** Clicking a header sorts by it (the Songs view). */
  readonly sortable?: boolean;
  /** Heads each disc's songs with its number. */
  readonly discs?: boolean;
  /** Rows can be dragged to a new place (a playlist, §9.2): the rows at `indexes` go to the gap `to`. */
  readonly onMove?: (indexes: readonly number[], to: number) => void;
}) {
  const songs = app.rows.value;
  const keys = app.rowKeys.value;
  const [gap, setGap] = useState<number | null>(null);
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
    lines.push({ song, index, key: keys[index]! });
  });
  const focusLine =
    selection.cursor === null ? -1 : lines.findIndex((l) => 'key' in l && l.key === selection.cursor);
  const { start, end } = useVirtualRows(scroller, lines.length, ROW_HEIGHT, focusLine, HEADER_HEIGHT);

  /** Opens the song menu under the cursor row, as the Menu key or Shift+F10 asks. */
  const menuFromKeys = () => {
    if (selection.cursor === null || app.blocked()) return;
    const row = document.getElementById(rowId(selection.cursor))?.getBoundingClientRect();
    const box = row ?? grid.current?.getBoundingClientRect();
    if (box) app.menu.value = { x: box.left + 24, y: row ? box.bottom : box.top };
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey)) {
      e.preventDefault();
      menuFromKeys();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || app.blocked()) return;
    const next = step(selection, keys, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    app.selection.value = next;
  };
  const pick = (e: MouseEvent, key: string) => {
    const how = e.shiftKey ? 'extend' : e.metaKey || e.ctrlKey ? 'toggle' : 'only';
    app.selection.value = click(selection, keys, key, how);
    grid.current?.focus();
  };
  /** Dragging starts from the selection, or just the row when it is outside it. */
  const dragged = (key: string): number[] =>
    selection.paths.has(key) ? app.selectedIndexes() : [keys.indexOf(key)];
  const startDrag = (e: DragEvent, key: string) => {
    const rows = dragged(key).filter((i) => songs[i]!.error !== MISSING);
    if (!e.dataTransfer || rows.length === 0) return e.preventDefault();
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(SONGS_TYPE, JSON.stringify(rows.map((i) => songs[i]!.path)));
    e.dataTransfer.setData('text/plain', rows.map((i) => songs[i]!.title).join('\n'));
    moving.current = onMove ? dragged(key) : null;
  };
  const moving = useRef<number[] | null>(null);
  const over = (e: DragEvent, index: number) => {
    if (!moving.current) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const to = e.clientY > box.top + box.height / 2 ? index + 1 : index;
    if (to !== gap) setGap(to);
  };
  const drop = (e: DragEvent) => {
    if (!moving.current || gap === null) return;
    e.preventDefault();
    onMove?.(moving.current, gap);
    moving.current = null;
    setGap(null);
  };
  const endDrag = () => {
    moving.current = null;
    setGap(null);
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
        onContextMenu={(e) => {
          // A row's right-click is handled by the row. On the list itself, the event came from the keyboard.
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          menuFromKeys();
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setGap(null);
        }}
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
                    <button
                      type="button"
                      class="pl-sort"
                      aria-label={c === 'favourite' ? 'Favourite' : undefined}
                      onClick={() => app.sortBy(c)}
                    >
                      {TITLES[c]}
                      {sorted && <span aria-hidden="true">{order.reverse ? ' ▾' : ' ▴'}</span>}
                    </button>
                  ) : (
                    <span aria-label={c === 'favourite' ? 'Favourite' : undefined}>{TITLES[c]}</span>
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
                key={line.key}
                id={rowId(line.key)}
                song={line.song}
                rowIndex={start + i + 2}
                stripe={line.index % 2 === 1}
                columns={columns}
                stats={app.stats.get(line.song.path)}
                onFavourite={() => app.stats.toggleFavourite([line.song.path])}
                selected={selection.paths.has(line.key)}
                cursor={selection.cursor === line.key}
                playing={line.song.path === playing ? state : null}
                drop={
                  gap === line.index
                    ? 'before'
                    : gap === songs.length && line.index === songs.length - 1
                      ? 'after'
                      : null
                }
                onPick={(e) => pick(e, line.key)}
                onMenu={(e) => {
                  // A right-click on a song outside the selection selects just it, as the Music app does.
                  if (!selection.paths.has(line.key)) app.selection.value = only(line.key);
                  grid.current?.focus();
                  app.menu.value = { x: e.clientX, y: e.clientY };
                }}
                onPlay={() => void app.playRow(line.key)}
                onDragStart={(e) => startDrag(e, line.key)}
                onDragOver={(e) => over(e, line.index)}
                onDrop={drop}
                onDragEnd={endDrag}
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

function cell(song: Song, column: Exclude<Column, 'favourite'>, stats: SongStats): string {
  switch (column) {
    case 'plays':
      return stats.plays > 0 ? formatCount(stats.plays) : '';
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
  readonly id: string;
  readonly song: Song;
  readonly rowIndex: number;
  readonly stripe: boolean;
  readonly columns: readonly Column[];
  readonly stats: SongStats;
  readonly onFavourite: () => void;
  readonly selected: boolean;
  /** The keyboard's place in the list: the row the arrow keys move from, drawn with the focus ring. */
  readonly cursor: boolean;
  /** The player's state when this is the playing song. */
  readonly playing: string | null;
  /** Where a dragged entry would land, shown as a line. */
  readonly drop: 'before' | 'after' | null;
  readonly onPick: (e: MouseEvent) => void;
  readonly onMenu: (e: MouseEvent) => void;
  readonly onPlay: () => void;
  readonly onDragStart: (e: DragEvent) => void;
  readonly onDragOver: (e: DragEvent) => void;
  readonly onDrop: (e: DragEvent) => void;
  readonly onDragEnd: () => void;
}) {
  const { song: s } = props;
  const missing = s.error === MISSING;
  const classes = [
    s.error ? 'pl-unreadable' : '',
    props.playing ? 'pl-playing' : '',
    props.stripe ? 'pl-stripe' : '',
    props.cursor ? 'pl-cursor' : '',
    props.drop ? `pl-drop-${props.drop}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <tr
      id={props.id}
      role="row"
      aria-rowindex={props.rowIndex}
      aria-selected={props.selected}
      class={classes || undefined}
      title={missing ? s.error : s.error ? `Can’t read this file: ${s.error}` : s.path}
      draggable={!missing}
      onMouseDown={(e) => {
        // A plain press on a selected row waits for the click, so the selection can be dragged.
        if (e.button === 0 && !(props.selected && !e.shiftKey && !e.metaKey && !e.ctrlKey)) props.onPick(e);
      }}
      onClick={(e) => {
        if (props.selected && !e.shiftKey && !e.metaKey && !e.ctrlKey) props.onPick(e);
        // A double tap zooms on a phone, so a tap plays (§18.5).
        if ('pointerType' in e && e.pointerType === 'touch' && !s.error) props.onPlay();
      }}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu(e);
      }}
      onDblClick={() => !s.error && props.onPlay()}
    >
      <td class="pl-col-mark">{props.playing && <PlayingMark moving={props.playing === 'playing'} />}</td>
      {props.columns.map((c) => (
        <td key={c} class={`pl-col-${c}`}>
          {c === 'favourite'
            ? !missing && <Heart on={props.stats.favourite} onToggle={props.onFavourite} tabIndex={-1} />
            : cell(s, c, props.stats)}
        </td>
      ))}
    </tr>
  );
}

/** The favourite heart (§10.2): filled when on. A press toggles it without touching the selection. */
export function Heart({
  on,
  onToggle,
  tabIndex,
}: {
  readonly on: boolean;
  readonly onToggle: () => void;
  readonly tabIndex?: number;
}) {
  return (
    <button
      type="button"
      class={`pl-heart${on ? ' pl-heart-on' : ''}`}
      aria-label="Favourite"
      aria-pressed={on}
      title={on ? 'Unfavourite' : 'Favourite'}
      tabIndex={tabIndex}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onDblClick={(e) => e.stopPropagation()}
    >
      <Icon name={on ? 'heart-filled' : 'heart'} />
    </button>
  );
}
