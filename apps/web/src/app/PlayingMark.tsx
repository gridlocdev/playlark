/** The playing song's mark in every list (PRD §7): three bars that move while it plays, still when paused. */
export function PlayingMark({ moving }: { readonly moving: boolean }) {
  return (
    <span class={`pl-bars${moving ? ' pl-bars-moving' : ''}`} role="img" aria-label="Playing">
      <span />
      <span />
      <span />
    </span>
  );
}
