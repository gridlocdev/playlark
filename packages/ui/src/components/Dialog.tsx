import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { isComposingKey, isSubmitKey, isUndoKey } from '../commands/shortcut.ts';
import { trapTab } from './focusTrap.ts';

/**
 * The one modal dialog: labelled by its title, Escape and a click on the backdrop close it, ⌘Enter (Ctrl+Enter)
 * submits it from any field, Tab stays inside it, focus moves in when it opens and goes back where it was when it closes.
 */
export function Dialog(props: {
  readonly title: string;
  readonly onClose: () => void;
  readonly class?: string;
  readonly children: ComponentChildren;
  readonly actions?: ComponentChildren;
  readonly onSubmit?: () => void;
  /** Escape, when it means something other than a click outside (a new event's popover, §7.1). */
  readonly onEscape?: () => void;
  /**
   * A popover: placed beside this element (right, else left, else below) over a clear backdrop, with an arrow
   * at it. The function runs once, when the popover opens; null centres it.
   */
  readonly anchor?: () => Element | null;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Taken while rendering: the body's own effects run first and may already have moved focus inside.
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  useLayoutEffect(() => {
    const b = box.current;
    const anchor = props.anchor;
    if (!anchor || !b) return;
    placeBeside(b, anchor(), true);
    // A popover that grows (a field added) moves to stay on screen.
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => placeBeside(b, anchor(), false));
    watch.observe(b);
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    const root = ref.current;
    const first =
      root?.querySelector<HTMLElement>('[data-autofocus]') ??
      root?.querySelector<HTMLElement>('input, select, textarea, button');
    if (!root?.contains(document.activeElement)) first?.focus();
    return () => {
      if (previous?.isConnected && previous !== document.body) previous.focus();
    };
  }, []);
  return (
    <div
      class={props.anchor ? 'pl-backdrop pl-backdrop-clear' : 'pl-backdrop'}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      {/* Keys are handled on the whole box (focusable, so a click on empty space keeps focus in it). */}
      <div
        ref={box}
        class={`pl-dialog ${props.anchor ? 'pl-popover' : ''} ${props.class ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (isComposingKey(e)) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            (props.onEscape ?? props.onClose)();
          } else if (props.onSubmit && isSubmitKey(e)) {
            e.preventDefault();
            e.stopPropagation();
            ref.current?.requestSubmit();
          } else if (isUndoKey(e) && !keepsOwnUndo(e.target)) {
            // The browser's own undo would take back typing in a field behind the dialog, and move the keyboard
            // there. A text field in the dialog keeps its undo.
            e.preventDefault();
            e.stopPropagation();
          } else if (ref.current) {
            trapTab(ref.current, e);
          }
        }}
      >
        <form
          ref={ref}
          autocomplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSubmit?.();
          }}
        >
          <h2 id={titleId}>{props.title}</h2>
          <div class="pl-dialog-body">{props.children}</div>
          {props.actions && <div class="pl-dialog-actions">{props.actions}</div>}
        </form>
      </div>
    </div>
  );
}

/** Input types that hold typed text, so ⌘Z in them undoes typing. A radio or checkbox has none. */
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

function keepsOwnUndo(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUTS.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

/** The gap between a popover and its element, and the window edge it keeps clear of. */
const GAP = 10;

/** Puts a popover beside `target`: right, else left, else below, kept inside the window (§7.2). */
function placeBeside(box: HTMLElement, target: Element | null, scroll: boolean): void {
  if (!target) return;
  if (scroll) target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const r = target.getBoundingClientRect();
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (v: number, max: number) => Math.max(GAP, Math.min(v, max - GAP));
  let side: 'right' | 'left' | 'below';
  let left: number;
  let top: number;
  if (r.right + GAP + w <= vw - GAP || r.left - GAP - w >= GAP) {
    side = r.right + GAP + w <= vw - GAP ? 'right' : 'left';
    left = side === 'right' ? r.right + GAP : r.left - GAP - w;
    top = clamp(r.top + r.height / 2 - h / 2, vh - h);
  } else {
    side = 'below';
    left = clamp(r.left + r.width / 2 - w / 2, vw - w);
    top = clamp(r.bottom + GAP, vh - h);
  }
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.dataset.side = side;
  // The arrow points at the middle of the element, as far as the popover's own edge allows.
  const arrow = side === 'below' ? r.left + r.width / 2 - left : r.top + r.height / 2 - top;
  box.style.setProperty('--pl-arrow', `${Math.max(16, Math.min(arrow, (side === 'below' ? w : h) - 16))}px`);
}
