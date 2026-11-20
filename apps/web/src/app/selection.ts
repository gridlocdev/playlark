/**
 * Selection in a song list (PRD §6.3): a set of paths, the cursor (the row the keys move from) and the anchor
 * (where a Shift range starts). Immutable; the functions take the list's rows in their shown order.
 */
import { cursorStep } from './cursor.ts';

export interface Selection {
  readonly paths: ReadonlySet<string>;
  readonly cursor: string | null;
  readonly anchor: string | null;
}

export const NO_SELECTION: Selection = { paths: new Set(), cursor: null, anchor: null };

/** Just `path`. */
export function only(path: string): Selection {
  return { paths: new Set([path]), cursor: path, anchor: path };
}

function range(rows: readonly string[], from: string | null, to: string): Set<string> {
  const a = from === null ? -1 : rows.indexOf(from);
  const b = rows.indexOf(to);
  if (a < 0 || b < 0) return new Set([to]);
  return new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1));
}

/** A click: `extend` (Shift) selects from the anchor; `toggle` (⌘ or Ctrl) adds or removes the row. */
export function click(
  sel: Selection,
  rows: readonly string[],
  path: string,
  how: 'only' | 'extend' | 'toggle' = 'only',
): Selection {
  if (how === 'extend')
    return { paths: range(rows, sel.anchor, path), cursor: path, anchor: sel.anchor ?? path };
  if (how === 'toggle') {
    const paths = new Set(sel.paths);
    if (!paths.delete(path)) paths.add(path);
    return { paths, cursor: path, anchor: path };
  }
  return only(path);
}

/** A navigation key; with `extend` (Shift) the range from the anchor grows. Undefined: not a key lists use. */
export function step(
  sel: Selection,
  rows: readonly string[],
  key: string,
  extend: boolean,
): Selection | undefined {
  const at = cursorStep(key, sel.cursor === null ? -1 : rows.indexOf(sel.cursor), rows.length);
  if (at === undefined) return undefined;
  const path = rows[at]!;
  return extend ? click(sel, rows, path, 'extend') : only(path);
}

export function all(rows: readonly string[]): Selection {
  return { paths: new Set(rows), cursor: rows[0] ?? null, anchor: rows[0] ?? null };
}

/**
 * The selection after the rows changed (§6.3): paths no longer shown are dropped, and a cursor whose row went
 * moves to the row that followed it, else the one before.
 */
export function keep(sel: Selection, before: readonly string[], after: readonly string[]): Selection {
  const shown = new Set(after);
  const paths = new Set([...sel.paths].filter((p) => shown.has(p)));
  let cursor = sel.cursor;
  if (cursor !== null && !shown.has(cursor)) {
    const at = before.indexOf(cursor);
    cursor =
      before.slice(at + 1).find((p) => shown.has(p)) ??
      before
        .slice(0, Math.max(0, at))
        .reverse()
        .find((p) => shown.has(p)) ??
      null;
    if (cursor !== null && paths.size === 0) paths.add(cursor);
  }
  const anchor = sel.anchor !== null && shown.has(sel.anchor) ? sel.anchor : cursor;
  if (paths.size === sel.paths.size && cursor === sel.cursor && anchor === sel.anchor) return sel;
  return { paths, cursor, anchor };
}

/** The selected rows in shown order; or the cursor's row when nothing is selected. */
export function selectedRows(sel: Selection, rows: readonly string[]): string[] {
  if (sel.paths.size > 0) return rows.filter((p) => sel.paths.has(p));
  return sel.cursor !== null && rows.includes(sel.cursor) ? [sel.cursor] : [];
}
