/**
 * The page's only effects outside the shared components. Each one keeps a piece of the DOM in step with the
 * model (a scroll position); none copies one piece of state into another.
 */
import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

/** Scrolls the element with id `id` inside `ref` into view whenever `id` changes (the list's cursor). */
export function useScrolledIntoView(ref: RefObject<HTMLElement | null>, id: string | null): void {
  useEffect(() => {
    if (id !== null) ref.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: 'nearest' });
  }, [ref, id]);
}
