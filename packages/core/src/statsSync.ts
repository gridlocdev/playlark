/**
 * Favourites and play counts shared by every device on a NAS server (PRD §18.2). A device sends what it changed
 * since it last read or sent the stats, never the whole file, so two phones playing at once both keep their plays.
 */
import { type FolderStats, NO_STATS, type SongStats } from './stats.ts';

/** One song's change: the favourite set, plays added, a later last play, its added time, or its stats gone. */
export interface StatsChange {
  readonly path: string;
  readonly favourite?: boolean;
  /** Plays to add (never negative). */
  readonly plays?: number;
  readonly lastPlayed?: number;
  readonly added?: number;
  /** The song's stats are taken out (it was moved or deleted). */
  readonly removed?: true;
}

/** What changed from `base` to `next`. */
export function statsChanges(base: FolderStats, next: FolderStats): StatsChange[] {
  const out: StatsChange[] = [];
  for (const [path, s] of next) {
    const b = base.get(path) ?? NO_STATS;
    const change: { -readonly [K in keyof StatsChange]: StatsChange[K] } = { path };
    if (s.favourite !== b.favourite) change.favourite = s.favourite;
    if (s.plays > b.plays) change.plays = s.plays - b.plays;
    if (s.lastPlayed !== null && s.lastPlayed !== b.lastPlayed) change.lastPlayed = s.lastPlayed;
    if (s.added !== null && s.added !== b.added) change.added = s.added;
    if (Object.keys(change).length > 1) out.push(change);
  }
  for (const path of base.keys()) if (!next.has(path)) out.push({ path, removed: true });
  return out;
}

/** `stats` with `changes` applied: plays add up, the latest play wins, the first added time stays. */
export function applyStatsChanges(stats: FolderStats, changes: readonly StatsChange[]): FolderStats {
  const out = new Map(stats);
  for (const c of changes) {
    if (c.removed) {
      out.delete(c.path);
      continue;
    }
    const s = out.get(c.path) ?? NO_STATS;
    const next: SongStats = {
      favourite: c.favourite ?? s.favourite,
      plays: s.plays + (c.plays ?? 0),
      lastPlayed:
        c.lastPlayed === undefined ? s.lastPlayed : Math.max(c.lastPlayed, s.lastPlayed ?? -Infinity),
      added: s.added ?? c.added ?? null,
    };
    out.set(c.path, next);
  }
  return out;
}

const isTime = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Changes sent over HTTP, or null when any of them isn't one. */
export function parseStatsChanges(value: unknown): StatsChange[] | null {
  if (!Array.isArray(value)) return null;
  const out: StatsChange[] = [];
  for (const v of value as unknown[]) {
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    const known = ['path', 'favourite', 'plays', 'lastPlayed', 'added', 'removed'];
    if (keys.some((k) => !known.includes(k)) || typeof o['path'] !== 'string' || o['path'] === '')
      return null;
    if (o['favourite'] !== undefined && typeof o['favourite'] !== 'boolean') return null;
    const plays = o['plays'];
    if (plays !== undefined && (typeof plays !== 'number' || !Number.isInteger(plays) || plays < 0))
      return null;
    if (o['lastPlayed'] !== undefined && !isTime(o['lastPlayed'])) return null;
    if (o['added'] !== undefined && !isTime(o['added'])) return null;
    if (o['removed'] !== undefined && o['removed'] !== true) return null;
    out.push(o as unknown as StatsChange);
  }
  return out;
}
