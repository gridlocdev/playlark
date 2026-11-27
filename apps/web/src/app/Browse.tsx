/**
 * The browse lists (PRD §6.2): album covers as a grid or a shelf, and the artists list. Each is one Tab stop with
 * roving focus kept in the controller (`app.lists`), so the arrow keys move a focus that the app knows about.
 */
import { useRef, useState } from 'preact/hooks';
import type { Album, Artist, CoverRef } from '@playlark/core';
import { formatCount, Icon, useVirtualRows, type RovingFocus } from '@playlark/ui';
import type { AppController } from './controller.ts';
import { listFocusId } from './listFocus.ts';

/** The props that make item `i` of `count` part of a roving-focus list: one Tab stop, focus drawn from state. */
export const roving = (focus: RovingFocus, i: number, count: number) => ({
  tabIndex: focus.tabIndex(i, count),
  ref: focus.ref(i),
  onFocus: () => focus.focused(i),
  // Safari doesn't focus a button on a click, so the click says which item is current too.
  onPointerDown: () => focus.focused(i),
});

/** How many items sit in the first row of a list that wraps (a shelf of covers, search's artist chips). */
function rowLength(list: Element): number {
  const items = [...list.children];
  const top = items[0]?.getBoundingClientRect().top;
  const n = items.findIndex((el) => el.getBoundingClientRect().top !== top);
  return n < 0 ? items.length : n;
}

/** Arrow keys on a list that wraps, its row length measured when the key is pressed. */
export const wrapKeys = (focus: RovingFocus, count: number) => (e: KeyboardEvent) =>
  focus.keyDown(e, count, rowLength(e.currentTarget as Element));

/** A cover, or the placeholder with a note glyph (§4.6). */
export function Cover({
  app,
  cover,
  large = false,
}: {
  readonly app: AppController;
  readonly cover: CoverRef | undefined;
  readonly large?: boolean;
}) {
  const url = app.coverOf(cover);
  return (
    <div class={`pl-cover${large ? ' pl-cover-large' : ''}`} aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" /> : <Icon name="music" />}
    </div>
  );
}

export const albumCount = (n: number) => (n === 1 ? '1 album' : `${formatCount(n)} albums`);

/** A card's width and height in px, the gap included (the last card in a row needs no gap). */
const CARD_WIDTH = 176;
const CARD_GAP = 16;
const CARD_HEIGHT = 224;
const GRID_PADDING = 32;

function AlbumCard({
  app,
  album,
  focus,
  index,
  count,
}: {
  readonly app: AppController;
  readonly album: Album;
  readonly focus: RovingFocus;
  readonly index: number;
  readonly count: number;
}) {
  return (
    <button
      type="button"
      class="pl-card"
      {...roving(focus, index, count)}
      title={`${album.title} – ${album.artist}`}
      onClick={() => app.navigate({ kind: 'album', key: album.key })}
    >
      <Cover app={app} cover={album.cover} />
      <span class="pl-card-title">{album.title}</span>
      <span class="pl-card-sub">{album.artist}</span>
    </button>
  );
}

/** Albums as a grid of covers (§6.2), drawing only the rows in view. */
export function AlbumGrid({
  app,
  albums,
  label,
}: {
  readonly app: AppController;
  readonly albums: readonly Album[];
  readonly label: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const focus = app.lists.get('albums');
  const row = Math.floor(focus.current(albums.length) / columns);
  const rows = Math.ceil(albums.length / columns);
  const { start, end, width } = useVirtualRows(scroller, rows, CARD_HEIGHT, row);
  const fit = Math.max(1, Math.floor((width - GRID_PADDING + CARD_GAP) / CARD_WIDTH));
  if (fit !== columns) setColumns(fit);
  return (
    <div
      class="pl-grid-scroll"
      ref={scroller}
      {...offscreenStop(focus, row >= start && row < end, row * CARD_HEIGHT)}
    >
      <section
        class="pl-album-grid"
        aria-label={label}
        onKeyDown={(e) => focus.keyDown(e, albums.length, columns)}
      >
        <div style={{ height: `${start * CARD_HEIGHT}px` }} />
        {Array.from({ length: end - start }, (_, i) => {
          const row = start + i;
          return (
            <div key={row} class="pl-card-row" style={{ gridTemplateColumns: `repeat(${columns}, 160px)` }}>
              {albums.slice(row * columns, row * columns + columns).map((a, j) => (
                <AlbumCard
                  key={a.key}
                  app={app}
                  album={a}
                  focus={focus}
                  index={row * columns + j}
                  count={albums.length}
                />
              ))}
            </div>
          );
        })}
        <div style={{ height: `${(rows - end) * CARD_HEIGHT}px` }} />
      </section>
    </div>
  );
}

/**
 * While a virtual list's current item is scrolled out of the drawn rows, the scroller itself is the Tab stop:
 * reaching it scrolls back to that item and gives it focus.
 */
function offscreenStop(focus: RovingFocus, drawn: boolean, top: number) {
  return drawn
    ? {}
    : {
        tabIndex: 0,
        onFocus: (e: FocusEvent) => {
          if (e.target !== e.currentTarget) return;
          focus.pull();
          (e.currentTarget as HTMLElement).scrollTop = top;
        },
      };
}

/** A few albums in a row that wraps, for artist pages and search. `id` names its roving focus. */
export function AlbumShelf({
  app,
  albums,
  label,
  id,
}: {
  readonly app: AppController;
  readonly albums: readonly Album[];
  readonly label: string;
  readonly id: string;
}) {
  const focus = app.lists.get(id);
  return (
    <div class="pl-shelf" role="list" aria-label={label} onKeyDown={wrapKeys(focus, albums.length)}>
      {albums.map((a, i) => (
        <div role="listitem" key={a.key}>
          <AlbumCard app={app} album={a} focus={focus} index={i} count={albums.length} />
        </div>
      ))}
    </div>
  );
}

/** Each album artist with their album count (§6.2), drawing only the rows in view. */
const ARTIST_ROW = 36;

export function ArtistList({
  app,
  artists,
}: {
  readonly app: AppController;
  readonly artists: readonly Artist[];
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const focus = app.lists.get(listFocusId({ kind: 'artists' })!);
  const current = focus.current(artists.length);
  const { start, end } = useVirtualRows(scroller, artists.length, ARTIST_ROW, current);
  return (
    <div
      class="pl-grid-scroll"
      ref={scroller}
      {...offscreenStop(focus, current >= start && current < end, current * ARTIST_ROW)}
    >
      <ul class="pl-artists" aria-label="Artists" onKeyDown={(e) => focus.keyDown(e, artists.length)}>
        <li style={{ height: `${start * ARTIST_ROW}px` }} aria-hidden="true" />
        {artists.slice(start, end).map((a, i) => (
          <li key={a.key}>
            <button
              type="button"
              {...roving(focus, start + i, artists.length)}
              onClick={() => app.navigate({ kind: 'artist', key: a.key })}
            >
              <span>{a.name}</span>
              <span class="pl-card-sub">{albumCount(a.albums.length)}</span>
            </button>
          </li>
        ))}
        <li style={{ height: `${(artists.length - end) * ARTIST_ROW}px` }} aria-hidden="true" />
      </ul>
    </div>
  );
}
