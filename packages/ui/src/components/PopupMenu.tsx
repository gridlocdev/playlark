import { useRef } from 'preact/hooks';
import type { CommandCatalog } from '../commands/command.ts';
import { Icon } from './Icon.tsx';

/**
 * A right-click or ⋯ menu made of catalog commands (`|` is a separator), so titles, ticks and enabled states
 * match every other way in. ↑ ↓ Home End move, Enter or Space runs, Escape or a click outside closes. It
 * focuses its first item as it arrives (a ref callback, not an effect) and keeps itself inside the window.
 * Escape and Tab give the keyboard back to what had it when the menu opened.
 */
export function PopupMenu(props: {
  readonly label: string;
  readonly catalog: CommandCatalog;
  readonly items: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
}) {
  const { catalog } = props;
  /** What had the keyboard when the menu opened; Escape and Tab give it back. */
  const previous = useRef<HTMLElement | null>(null);
  const place = (el: HTMLDivElement | null) => {
    if (!el || el.dataset.placed) return;
    el.dataset.placed = '1';
    previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const x = props.x + el.offsetWidth > innerWidth - 4 ? Math.max(4, props.x - el.offsetWidth) : props.x;
    const y = props.y + el.offsetHeight > innerHeight - 4 ? Math.max(4, props.y - el.offsetHeight) : props.y;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const menu = e.currentTarget as HTMLElement;
    const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      props.onClose();
      previous.current?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      class="pl-menu-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onClose();
      }}
    >
      <div ref={place} class="pl-menu" role="menu" aria-label={props.label} onKeyDown={onKeyDown}>
        {props.items.map((id, i) => {
          if (id === '|') return <div key={i} class="pl-menu-sep" role="separator" />;
          const c = catalog.get(id);
          if (!c) return null;
          const checked = c.checked?.();
          return (
            <button
              key={id}
              type="button"
              role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={checked}
              class="pl-menu-item"
              disabled={!catalog.isEnabled(c)}
              onClick={() => {
                catalog.run(id);
                props.onClose();
              }}
            >
              <span class="pl-menu-check">{checked && <Icon name="check" />}</span>
              <span class="pl-menu-title">{c.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
