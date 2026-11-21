/** The views and moving between them (PRD §6.1, §6.2): Back and Forward walk the views opened before. */

export type View =
  | { readonly kind: 'songs' }
  | { readonly kind: 'albums' }
  | { readonly kind: 'album'; readonly key: string }
  | { readonly kind: 'artists' }
  | { readonly kind: 'artist'; readonly key: string }
  | { readonly kind: 'folders'; readonly path: string }
  | { readonly kind: 'search'; readonly query: string }
  | { readonly kind: 'playlist'; readonly path: string }
  | { readonly kind: 'favourites' }
  | { readonly kind: 'recent' }
  | { readonly kind: 'mostPlayed' }
  /** The collections and playlists as a page: the phone layout's Playlists tab (§18.5). */
  | { readonly kind: 'playlists' };

export const SONGS: View = { kind: 'songs' };

export function sameView(a: View, b: View): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The views behind and ahead of the one shown. Immutable. */
export interface History {
  readonly back: readonly View[];
  readonly current: View;
  readonly forward: readonly View[];
}

/** How many views Back can go through. */
export const HISTORY_LIMIT = 100;

export const startHistory = (view: View = SONGS): History => ({ back: [], current: view, forward: [] });

/** Opens `view`; what was ahead is dropped. Opening the view already shown changes nothing. */
export function go(h: History, view: View): History {
  if (sameView(h.current, view)) return h;
  return { back: [...h.back, h.current].slice(-HISTORY_LIMIT), current: view, forward: [] };
}

/** Shows `view` in place of the current one, leaving Back and Forward as they are (search as you type). */
export function replace(h: History, view: View): History {
  return { ...h, current: view };
}

export function back(h: History): History {
  const to = h.back.at(-1);
  return to ? { back: h.back.slice(0, -1), current: to, forward: [h.current, ...h.forward] } : h;
}

export function forward(h: History): History {
  const to = h.forward[0];
  return to ? { back: [...h.back, h.current], current: to, forward: h.forward.slice(1) } : h;
}

/**
 * After a playlist was renamed (`to`) or deleted (null): views of it follow the new name, or are dropped, and a
 * dropped current view becomes Songs.
 */
export function playlistMoved(h: History, from: string, to: string | null): History {
  const was = (v: View) => v.kind === 'playlist' && v.path === from;
  const map = (v: View): View | null => (was(v) ? (to === null ? null : { kind: 'playlist', path: to }) : v);
  const keep = (list: readonly View[]) => list.flatMap((v) => map(v) ?? []);
  if (!was(h.current) && !h.back.some(was) && !h.forward.some(was)) return h;
  return { back: keep(h.back), current: map(h.current) ?? SONGS, forward: keep(h.forward) };
}
