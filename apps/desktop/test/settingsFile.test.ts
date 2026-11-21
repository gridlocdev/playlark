import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSettingsText, saveSettingsText, themeSourceOf } from '../src/index.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'playlark-settings-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('settings.json (PRD §19)', () => {
  it('starts with none, then keeps what the page saves', async () => {
    const file = path.join(dir, 'settings.json');
    expect(await loadSettingsText(file)).toBeNull();
    await saveSettingsText(file, '{"appearance":"dark"}\n');
    expect(await readFile(file, 'utf8')).toBe('{"appearance":"dark"}\n');
    expect(themeSourceOf(await loadSettingsText(file))).toBe('dark');
  });

  it('refuses what isn’t JSON text', async () => {
    const file = path.join(dir, 'settings.json');
    await expect(saveSettingsText(file, 42)).rejects.toThrow();
    await expect(saveSettingsText(file, '{oops')).rejects.toThrow();
    expect(await loadSettingsText(file)).toBeNull();
  });

  it('follows the system for a missing, damaged or unknown appearance', () => {
    expect(themeSourceOf(null)).toBe('system');
    expect(themeSourceOf('{oops')).toBe('system');
    expect(themeSourceOf('{"appearance":"blue"}')).toBe('system');
    expect(themeSourceOf('{"appearance":"light"}')).toBe('light');
  });
});
