/** The collections (PRD §6.2): Favourites, Recently Added and Most Played, made from the stats (§10). */
import { Icon } from '@playlark/ui';
import type { AppController } from './controller.ts';
import type { View } from './views.ts';

export type CollectionKind = 'favourites' | 'recent' | 'mostPlayed';

const COLLECTIONS: readonly {
  readonly kind: CollectionKind;
  readonly title: string;
  readonly icon: string;
  /** The one line an empty collection shows: how to fill it. */
  readonly empty: string;
}[] = [
  {
    kind: 'favourites',
    title: 'Favourites',
    icon: 'heart',
    empty: 'Songs you favourite appear here. Click the heart beside a song, or choose Favourite in its menu.',
  },
  {
    kind: 'recent',
    title: 'Recently Added',
    icon: 'clock',
    empty: 'Songs added to the music folder in the last 90 days appear here.',
  },
  { kind: 'mostPlayed', title: 'Most Played', icon: 'trending-up', empty: 'Songs you play appear here.' },
];

/** A collection's title, icon and empty line. */
export const collection = (kind: CollectionKind) => COLLECTIONS.find((c) => c.kind === kind)!;

/** The sidebar's Collections section. */
export function SidebarCollections({
  app,
  current,
}: {
  readonly app: AppController;
  readonly current: View['kind'];
}) {
  return (
    <>
      <h2 class="pl-sidebar-title">Collections</h2>
      <ul aria-label="Collections">
        {COLLECTIONS.map((c) => (
          <li key={c.kind}>
            <button
              type="button"
              aria-current={current === c.kind ? 'page' : undefined}
              onClick={() => app.navigate({ kind: c.kind })}
            >
              <Icon name={c.icon} /> {c.title}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
