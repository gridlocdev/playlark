/** The Settings window's values (PRD §19), as a signal, kept through the page's settings storage. */
import { signal } from '@preact/signals';
import type { Appearance, Settings, SettingsStorage } from '@playlark/ui';

export class Preferences {
  readonly value;
  readonly #storage: SettingsStorage;

  constructor(storage: SettingsStorage) {
    this.#storage = storage;
    this.value = signal<Settings>(storage.load());
  }

  /** Changes some settings; false when they couldn't be kept and last only while the window is open. */
  set(change: Partial<Settings>): boolean {
    const next = { ...this.value.peek(), ...change };
    this.value.value = next;
    return this.#storage.save(next);
  }
}

/** Light or dark on the page; 'system' follows the system's own (PRD §19). */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  if (appearance === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = appearance;
}
