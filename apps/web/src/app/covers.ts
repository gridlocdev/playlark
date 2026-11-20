/** Cover URLs for the open folder (PRD §4.6), worked out once each and kept as a signal so the views redraw. */
import { signal } from '@preact/signals';
import type { CoverRef } from '@playlark/core';
import type { IndexStore, LibrarySource } from '@playlark/ui';

export interface CoverOptions {
  readonly index: IndexStore | undefined;
  /** Makes a URL for an image file's bytes; without it, folder images show the placeholder. */
  readonly imageUrl: ((bytes: ArrayBuffer, mime: string) => string) | undefined;
  readonly source: () => LibrarySource | null;
}

export class Covers {
  readonly #urls = signal<ReadonlyMap<string, string | null>>(new Map());
  readonly #loads = new Set<string>();
  readonly #options: CoverOptions;

  constructor(options: CoverOptions) {
    this.#options = options;
  }

  /** Forgets every cover, for a newly opened folder. */
  reset(): void {
    this.#urls.value = new Map();
  }

  /**
   * The URL for a cover, or null for the placeholder. The first call for a cover starts working it out and
   * returns null; the signal redraws whoever asked once it is ready.
   */
  urlOf(cover: CoverRef | undefined): string | null {
    if (!cover) return null;
    const key = cover.kind === 'embedded' ? `id:${cover.id}` : `file:${cover.path}`;
    const known = this.#urls.value.get(key);
    if (known !== undefined) return known;
    if (!this.#loads.has(key)) {
      this.#loads.add(key);
      void this.#load(cover).then((url) => {
        this.#loads.delete(key);
        this.#urls.value = new Map(this.#urls.peek()).set(key, url);
      });
    }
    return null;
  }

  /** Never throws: a cover that can't be read is the placeholder. */
  async #load(cover: CoverRef): Promise<string | null> {
    try {
      if (cover.kind === 'embedded') return (await this.#options.index?.coverUrl(cover.id)) ?? null;
      const source = this.#options.source();
      const imageUrl = this.#options.imageUrl;
      if (!source || !imageUrl) return null;
      const mime = cover.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      return imageUrl(await source.bytes(cover.path), mime);
    } catch {
      return null;
    }
  }
}
