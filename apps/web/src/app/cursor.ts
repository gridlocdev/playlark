/** Moving the list's cursor with the keyboard (PRD §6.3). */

/** How many rows Page Up and Page Down move. */
const PAGE = 15;

/** The cursor after a navigation key, or undefined for keys the list doesn't handle (§6.3). */
export function cursorStep(key: string, index: number, count: number): number | undefined {
  if (count === 0) return undefined;
  const at = (i: number) => Math.max(0, Math.min(count - 1, i));
  switch (key) {
    case 'ArrowDown':
      return at(index + 1);
    case 'ArrowUp':
      return at(index < 0 ? 0 : index - 1);
    case 'PageDown':
      return at(index + PAGE);
    case 'PageUp':
      return at(index - PAGE);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
