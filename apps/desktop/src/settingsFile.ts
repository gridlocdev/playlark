/**
 * `settings.json` in the desktop app's data folder (PRD §19). The page owns its fields; the main process only
 * reads the appearance, for the window's own parts. No Electron imports, so tests run it.
 */
import { readTextFile, writeAtomic } from '@playlark/node-files';

/** The page's settings are JSON of a few hundred bytes; anything far bigger isn't ours. */
const MAX_SETTINGS_BYTES = 64 * 1024;

export async function loadSettingsText(file: string): Promise<string | null> {
  return (await readTextFile(file)).text;
}

export async function saveSettingsText(file: string, text: unknown): Promise<void> {
  if (typeof text !== 'string' || text.length > MAX_SETTINGS_BYTES) throw new Error('Those aren’t settings.');
  JSON.parse(text);
  await writeAtomic(file, text);
}

export type ThemeSource = 'system' | 'light' | 'dark';

/** The appearance saved in `text`, or 'system'. */
export function themeSourceOf(text: string | null): ThemeSource {
  if (text === null) return 'system';
  try {
    const a = (JSON.parse(text) as { appearance?: unknown } | null)?.appearance;
    return a === 'light' || a === 'dark' ? a : 'system';
  } catch (e) {
    if (e instanceof SyntaxError) return 'system';
    throw e;
  }
}
