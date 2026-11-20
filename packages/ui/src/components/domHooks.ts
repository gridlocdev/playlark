/**
 * The page's only effects outside the shared components. Each one keeps a piece of the DOM in step with the
 * model (a scroll position, the visible rows); none copies one piece of state into another.
 */
import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';

/** Scrolls the element with id `id` inside `ref` into view whenever `id` changes (the list's cursor). */
export function useScrolledIntoView(ref: RefObject<HTMLElement | null>, id: string | null): void {
  useEffect(() => {
    if (id !== null) ref.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: 'nearest' });
  }, [ref, id]);
}

/** Rows drawn beyond the visible ones, above and below, so a quick scroll shows no blank. */
export const OVERSCAN = 8;

export interface VisibleRows {
  /** The first row to draw. */
  readonly start: number;
  /** One past the last row to draw. */
  readonly end: number;
  /** The scroller's width, for grids that fit columns to it. */
  readonly width: number;
}

/** The rows of fixed height `rowHeight` that show in the scroller `ref`, past a header `offset` px tall. */
export function visibleRows(
  scrollTop: number,
  height: number,
  rowHeight: number,
  count: number,
  offset = 0,
): { start: number; end: number } {
  const top = Math.max(0, scrollTop - offset);
  const start = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
  const end = Math.min(count, Math.ceil((top + height) / rowHeight) + OVERSCAN);
  return { start, end };
}

/**
 * Which of `count` rows to draw in the scroller `ref` (PRD §6.1: only the visible rows are drawn), redrawn as it
 * scrolls or resizes. When `focus` changes, scrolls so that row shows.
 */
export function useVirtualRows(
  ref: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  focus: number,
  offset = 0,
): VisibleRows {
  const [box, setBox] = useState({ top: 0, height: 800, width: 800 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [ref]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || focus < 0) return;
    const top = offset + focus * rowHeight;
    // The header row stays over the list, so a row is in view only below it.
    if (top - offset < el.scrollTop) el.scrollTop = top - offset;
    else if (top + rowHeight > el.scrollTop + el.clientHeight)
      el.scrollTop = top + rowHeight - el.clientHeight;
  }, [ref, focus, rowHeight, offset]);
  return { ...visibleRows(box.top, box.height, rowHeight, count, offset), width: box.width };
}
