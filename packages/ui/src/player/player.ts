/**
 * The player (PRD §8): the queue, what's playing and where, as signals the UI draws. It reads songs through the
 * library source and plays them through an `AudioEngine`.
 */
import { computed, signal, type Signal } from '@preact/signals';
import { EMPTY_QUEUE, type Queue, type Song, current, next, playFrom, previous } from '@playlark/core';
import type { AudioEngine, DecodedSong } from './engine.ts';

export type PlayState = 'stopped' | 'loading' | 'playing' | 'paused';

/** Three songs in a row that can't be played stop playback (PRD §8.3). */
export const MAX_FAILURES = 3;
/** ⌥⌘→ / ⌥⌘← move this many seconds (PRD §14). */
export const SEEK_STEP = 10;
/** ⌘↑ / ⌘↓ change the volume by this much (PRD §8.3). */
export const VOLUME_STEP = 0.1;

export interface PlayerOptions {
  readonly engine: AudioEngine;
  /** A song's bytes. */
  readonly bytes: (path: string) => Promise<ArrayBuffer>;
  /** The song for a path, or undefined when it's gone from the library. */
  readonly song: (path: string) => Song | undefined;
  readonly say: (text: string, tone?: 'error') => void;
  readonly volume?: number;
  readonly onVolume?: (volume: number) => void;
}

export class Player {
  readonly queue = signal<Queue>(EMPTY_QUEUE);
  readonly state = signal<PlayState>('stopped');
  /** Seconds into the current song; `tick` keeps it moving while playing. */
  readonly position = signal(0);
  readonly duration = signal(0);
  readonly volume: Signal<number>;
  readonly currentPath = computed(() => current(this.queue.value));
  readonly currentSong = computed(() => {
    const path = this.currentPath.value;
    return path === undefined ? undefined : this.#options.song(path);
  });

  readonly #options: PlayerOptions;
  /** Bumped by every load, so a slow decode that finishes after the user moved on is dropped. */
  #load = 0;
  #failures = 0;
  #decoded: DecodedSong | null = null;

  constructor(options: PlayerOptions) {
    this.#options = options;
    this.volume = signal(options.volume ?? 1);
    options.engine.setVolume(this.volume.peek());
    options.engine.onEnded = () => void this.#ended();
    options.engine.onBlocked = () => {
      void this.#options.engine.pause();
      this.position.value = this.#options.engine.position();
      this.state.value = 'paused';
      this.#options.say('The browser kept the sound off. Press Play to start it.');
    };
  }

  /** Replaces the queue with `paths` and plays from `index` (PRD §8.2). */
  async playFrom(paths: readonly string[], index: number): Promise<void> {
    this.queue.value = playFrom(paths, index);
    this.#failures = 0;
    await this.#playCurrent();
  }

  /** Play/Pause: with nothing loaded, does nothing (the app plays the view instead). */
  async toggle(): Promise<void> {
    switch (this.state.peek()) {
      case 'playing':
        await this.#options.engine.pause();
        this.position.value = this.#options.engine.position();
        this.state.value = 'paused';
        return;
      case 'paused':
        if (this.#decoded) {
          await this.#options.engine.resume();
          this.state.value = 'playing';
        } else await this.#playCurrent();
        return;
      case 'loading':
      case 'stopped':
        return;
    }
  }

  async next(): Promise<void> {
    const q = next(this.queue.peek());
    if (!q) return this.#end();
    this.queue.value = q;
    await this.#playCurrent();
  }

  async previous(): Promise<void> {
    const { queue, restart } = previous(this.queue.peek(), this.#options.engine.position());
    if (restart) return this.seek(0);
    this.queue.value = queue;
    await this.#playCurrent();
  }

  /** Plays the queue entry at `index` (a click in the queue panel). */
  async jumpTo(index: number): Promise<void> {
    const q = this.queue.peek();
    if (index < 0 || index >= q.items.length) return;
    this.queue.value = { items: q.items, index };
    this.#failures = 0;
    await this.#playCurrent();
  }

  /** Moves to `seconds` in the current song. */
  async seek(seconds: number): Promise<void> {
    const song = this.#decoded;
    if (!song) return;
    const at = Math.max(0, Math.min(seconds, song.duration));
    const wasPaused = this.state.peek() === 'paused';
    this.#options.engine.start(song, at);
    this.position.value = at;
    if (wasPaused) await this.#options.engine.pause();
  }

  seekBy(delta: number): Promise<void> {
    return this.seek(this.#options.engine.position() + delta);
  }

  setVolume(volume: number): void {
    const v = Math.round(Math.max(0, Math.min(1, volume)) * 100) / 100;
    this.volume.value = v;
    this.#options.engine.setVolume(v);
    this.#options.onVolume?.(v);
  }

  /** Brings `position` up to date; the app calls it a few times a second while playing. */
  tick(): void {
    if (this.state.peek() === 'playing') this.position.value = this.#options.engine.position();
  }

  stop(): void {
    this.#load++;
    this.#options.engine.stop();
    this.#decoded = null;
    this.queue.value = EMPTY_QUEUE;
    this.state.value = 'stopped';
    this.position.value = 0;
    this.duration.value = 0;
  }

  async #playCurrent(): Promise<void> {
    const path = current(this.queue.peek());
    if (path === undefined) return this.#end();
    const load = ++this.#load;
    const song = this.#options.song(path);
    this.#options.engine.stop();
    this.#decoded = null;
    this.state.value = 'loading';
    this.position.value = 0;
    this.duration.value = song?.duration ?? 0;
    let decoded: DecodedSong;
    try {
      if (!song) throw new Gone();
      const bytes = await this.#options.bytes(path);
      if (load !== this.#load) return;
      decoded = await this.#options.engine.decode(bytes);
    } catch (e) {
      if (load !== this.#load) return;
      return this.#failed(song?.title ?? path, e);
    }
    if (load !== this.#load) return;
    this.#failures = 0;
    this.#decoded = decoded;
    this.duration.value = decoded.duration;
    this.#options.engine.start(decoded, 0);
    this.state.value = 'playing';
  }

  async #failed(title: string, e: unknown): Promise<void> {
    this.#failures++;
    const why = e instanceof Gone ? 'the file is gone' : 'can’t play this format here';
    if (this.#failures >= MAX_FAILURES) {
      this.#options.say(`Playback stopped: ${MAX_FAILURES} songs in a row couldn’t be played.`, 'error');
      this.#failures = 0;
      return this.#end();
    }
    this.#options.say(`Skipped ${title}: ${why}.`, 'error');
    const q = next(this.queue.peek());
    if (!q) return this.#end();
    this.queue.value = q;
    await this.#playCurrent();
  }

  async #ended(): Promise<void> {
    const q = next(this.queue.peek());
    if (q) {
      this.queue.value = q;
      return this.#playCurrent();
    }
    return this.#end();
  }

  /** The end of the queue: the last song stays shown, paused at 0:00 (PRD §8.4). */
  #end(): void {
    this.#load++;
    this.#options.engine.stop();
    this.#decoded = null;
    this.position.value = 0;
    this.state.value = this.queue.peek().items.length > 0 ? 'paused' : 'stopped';
  }
}

class Gone extends Error {}
