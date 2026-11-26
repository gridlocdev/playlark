/**
 * Where focus goes back to when a dialog or the command menu closes. A dialog opened from the command menu
 * replaces it, and by the time the dialog is drawn the menu's field has gone with it (nothing has focus). The
 * dialog then sends focus back to where the menu itself came from: the list item the user started on.
 */
const returns = new WeakMap<Element, HTMLElement | null>();
/** The popup that opened last, while it is open or is being replaced. */
let last: { readonly root: Element; readonly previous: HTMLElement | null } | null = null;

/** Records that focus goes back to `previous` when the popup `root` closes. */
export function rememberReturn(root: Element | null, previous: HTMLElement | null): void {
  if (!root) return;
  returns.set(root, previous);
  last = { root, previous };
}

/**
 * The popup `root` closed. A popup that replaces it has already been drawn by now (Preact draws the new one
 * before it removes the old), so it has already asked `returnTarget`.
 */
export function forgetReturn(root: Element | null): void {
  if (last?.root === root) last = null;
}

/** Where focus should go back to when a popup that opened while `active` had focus closes. */
export function returnTarget(active: Element | null): HTMLElement | null {
  const popup = active?.closest('[role="dialog"]');
  if (popup && returns.has(popup)) return returns.get(popup) ?? null;
  const nothing = !active || active === active.ownerDocument.body;
  if (nothing && last && !last.root.isConnected) return last.previous;
  return active instanceof HTMLElement ? active : null;
}
