/**
 * The roving focus of each list of buttons (album covers, artists, a folder's subfolders, search's artists), kept
 * in the model so it outlives the list's page: Back to a list gives focus back to the item it was on.
 */
import { RovingFocus } from '@playlark/ui';
import type { View } from './views.ts';

/**
 * The id of the view's main list of buttons, or null for views without one. Back and Forward give focus back to
 * that list's item.
 */
export function listFocusId(view: View): string | null {
  switch (view.kind) {
    case 'albums':
      return 'albums';
    case 'artists':
      return 'artists';
    case 'folders':
      return `folder:${view.path}`;
    case 'artist':
      return `artist:${view.key}:albums`;
    case 'album':
    case 'favourites':
    case 'mostPlayed':
    case 'playlist':
    case 'playlists':
    case 'recent':
    case 'search':
    case 'songs':
      return null;
  }
}

export class ListFocus {
  readonly #lists = new Map<string, RovingFocus>();

  /** The list `id`'s roving focus, made on its first visit. */
  get(id: string): RovingFocus {
    let focus = this.#lists.get(id);
    if (!focus) this.#lists.set(id, (focus = new RovingFocus()));
    return focus;
  }

  /**
   * After Back or Forward to `view`: with nothing focused (the item clicked to leave went away with its page), the
   * view's list gives focus back to its item when it draws.
   */
  returnTo(view: View, active: Element | null, body: Element | null): void {
    if (active && active !== body) return;
    const id = listFocusId(view);
    if (id) this.#lists.get(id)?.pull();
  }
}
