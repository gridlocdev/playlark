/**
 * The player (PRD §8): the queue, what's playing and where, as signals the UI draws. It reads songs through the
 * library source and plays them through an `AudioEngine`. While a song plays, the one after it is decoded and
 * handed to the engine to start on the exact sample this one ends (§8.6).
 */
import { computed, signal, type Signal } from '@preact/signals';
import {
  EMPTY_QUEUE,
  type Queue,
  type ReplayGainMode,
  type SavedQueue,
  type Song,
  addToQueue,
  clearUpNext,
  crossfadeFor,
  current,
  toggleLoopQueue,
  toggleLoopSong,
  following,
  isShuffled,
  jumpTo,
  move,
  next,
  playFrom,
  playNext,
  previous,
  prune,
  removeAt,
  replayGainFactor,
  setShuffle,
  shuffleAll,
} from '@playlark/core';
import type { AudioEngine, DecodedSong } from './engine.ts';

export type PlayState = 'stopped' | 'loading' | 'playing' | 'paused';

/** Three songs in a row that can't be played stop playback (PRD §8.3). */
export const MAX_FAILURES = 3;
/** ⌥⌘→ / ⌥⌘← move this many seconds (PRD §14). */
export const SEEK_STEP = 10;
/** ⌘↑ / ⌘↓ change the volume by this much (PRD §8.3). */
export const VOLUME_STEP = 0.1;
/** The next song is decoded once this many seconds are left in the playing one (PRD §8.6). */
export const PRELOAD_AHEAD = 30;

export interface PlaybackSettings {
  readonly replayGain: ReplayGainMode;
  readonly preamp: number;
  readonly crossfade: number;
}

export interface PlayerOptions {
  readonly engine: AudioEngine;
  /** A song's bytes. */
  readonly bytes: (path: string) => Promise<ArrayBuffer>;
  /** The song for a path, or undefined when it's gone from the library. */
  readonly song: (path: string) => Song | undefined;
  readonly say: (text: string, tone?: 'error') => void;
  readonly volume?: number;
  readonly onVolume?: (volume: number) => void;
  /** ReplayGain and crossfade, read each time a song starts. */
  readonly playback?: () => PlaybackSettings;
  /** A seed for each shuffle; tests pin it. */
  readonly seed?: () => number;
}

const NO_EFFECTS: PlaybackSettings = { replayGain: 'off', preamp: 0, crossfade: 0 };

/** The song decoded ahead, and the path it is for. */
interface Ahead {
  readonly path: string;
  /** Null while it decodes, or when it can't be decoded. */
  readonly decoded: DecodedSong | null;
  /** Handed to the engine. */
  readonly queued: boolean;
}

export class Player {
  readonly queue = signal<Queue>(EMPTY_QUEUE);
  readonly state = signal<PlayState>('stopped');
  /** Seconds into the current song; `tick` keeps it moving while playing. */
  readonly position = signal(0);
  readonly duration = signal(0);
  /** Goes up by one each time a song starts playing (not on a seek or a resume): what play counts follow (§10.2). */
  readonly started = signal(0);
  readonly volume: Signal<number>;
  readonly currentPath = computed(() => current(this.queue.value));
  readonly currentSong = computed(() => {
    const path = this.currentPath.value;
    return path === undefined ? undefined : this.#options.song(path);
  });
  readonly shuffle = computed(() => isShuffled(this.queue.value));
  readonly repeat = computed(() => this.queue.value.repeat);

  readonly #options: PlayerOptions;
  /** Bumped by every load, so a slow decode that finishes after the user moved on is dropped. */
  #load = 0;
  #failures = 0;
  #decoded: DecodedSong | null = null;
  #ahead: Ahead | null = null;

  constructor(options: PlayerOptions) {
    this.#options = options;
    this.volume = signal(options.volume ?? 1);
    const engine = options.engine;
    engine.setVolume(this.volume.peek());
    engine.onEnded = () => void this.#ended();
    engine.onAdvance = () => this.#advanced();
    engine.onBlocked = () => {
      void engine.pause();
      this.position.value = engine.position();
      this.state.value = 'paused';
      this.#options.say('The browser kept the sound off. Press Play to start it.');
    };
  }

  /** Replaces the queue with `paths` and plays from `index` (PRD §8.2); with shuffle on, what follows is shuffled. */
  playFrom(paths: readonly string[], index: number): Promise<void> {
    return this.#start(playFrom(paths, index, this.queue.peek(), this.#seed()));
  }

  /** The Shuffle buttons (PRD §8.2): shuffle on, and the whole list in a random order. */
  shuffleAll(paths: readonly string[]): Promise<void> {
    return this.#start(shuffleAll(paths, this.#seed(), this.queue.peek()));
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
        } else await this.#playCurrent(this.position.peek());
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

  /** Plays the queue entry at `index` (a double-click in the queue panel). */
  async jumpTo(index: number): Promise<void> {
    const q = jumpTo(this.queue.peek(), index);
    if (!q) return;
    this.queue.value = q;
    this.#failures = 0;
    await this.#playCurrent();
  }

  /** Moves to `seconds` in the current song. */
  async seek(seconds: number): Promise<void> {
    const song = this.#decoded;
    if (!song) {
      if (this.state.peek() === 'paused') this.position.value = Math.max(0, seconds);
      return;
    }
    const at = Math.max(0, Math.min(seconds, song.duration));
    const wasPaused = this.state.peek() === 'paused';
    this.#options.engine.play(song, at, this.#gain(this.currentSong.peek()));
    this.position.value = at;
    if (wasPaused) await this.#options.engine.pause();
    this.#requeue();
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

  /** Shuffle (⌘S, PRD §8.5). */
  toggleShuffle(): void {
    this.#edit(setShuffle(this.queue.peek(), !this.shuffle.peek(), this.#seed()));
  }

  /** Loop This Song (⌥⌘R, PRD §8.5). */
  toggleLoopSong(): void {
    this.#edit(toggleLoopSong(this.queue.peek()));
  }

  /** Loop Queue (⌥⇧⌘R, PRD §8.5). */
  toggleLoopQueue(): void {
    this.#edit(toggleLoopQueue(this.queue.peek()));
  }

  /** Play Next (PRD §8.2). With nothing playing, the songs wait in the queue. */
  playNext(paths: readonly string[]): void {
    this.#edit(playNext(this.queue.peek(), paths));
  }

  /** Add to Queue (PRD §8.2). */
  addToQueue(paths: readonly string[]): void {
    this.#edit(addToQueue(this.queue.peek(), paths));
  }

  /** Takes Up Next entries out (PRD §8.4); the playing song stays. */
  remove(indexes: readonly number[]): void {
    this.#edit(removeAt(this.queue.peek(), indexes));
  }

  clearUpNext(): void {
    this.#edit(clearUpNext(this.queue.peek()));
  }

  /** Drags an Up Next entry (PRD §8.4). */
  move(from: number, to: number): void {
    this.#edit(move(this.queue.peek(), from, to));
  }

  /**
   * Puts back a queue kept from the last run (PRD §8.4), paused where it was. Songs gone from the library are
   * dropped and counted.
   */
  restore(saved: SavedQueue): number {
    this.stop();
    const exists = (p: string) => this.#options.song(p) !== undefined;
    const q = prune(saved.queue, exists);
    const gone = saved.queue.items.filter((p) => !exists(p)).length;
    this.queue.value = q;
    if (q.index >= 0) {
      const kept = current(q) === current(saved.queue);
      this.state.value = 'paused';
      this.position.value = kept ? saved.position : 0;
      this.duration.value = this.currentSong.peek()?.duration ?? 0;
    }
    return gone;
  }

  /**
   * Drops queue entries for songs no longer in the library; stops if the playing one went. Returns how many were
   * dropped.
   */
  prune(): number {
    const q = this.queue.peek();
    const playing = current(q);
    const pruned = prune(q, (p) => this.#options.song(p) !== undefined);
    if (pruned === q) return 0;
    const gone = q.items.length - pruned.items.length;
    if (playing !== undefined && current(pruned) !== playing) {
      this.queue.value = pruned;
      this.#end();
      return gone;
    }
    this.#edit(pruned);
    return gone;
  }

  /** Brings `position` up to date and decodes the next song in time; the app calls it a few times a second. */
  tick(): void {
    if (this.state.peek() !== 'playing') return;
    this.position.value = this.#options.engine.position();
    this.#prepare();
  }

  stop(): void {
    this.#load++;
    this.#options.engine.stop();
    this.#decoded = null;
    this.#ahead = null;
    this.queue.value = EMPTY_QUEUE;
    this.state.value = 'stopped';
    this.position.value = 0;
    this.duration.value = 0;
  }

  #seed(): number {
    return this.#options.seed?.() ?? Math.floor(Math.random() * 2 ** 32);
  }

  #settings(): PlaybackSettings {
    return this.#options.playback?.() ?? NO_EFFECTS;
  }

  #gain(song: Song | undefined): number {
    const s = this.#settings();
    return replayGainFactor(song?.replayGain, s.replayGain, s.preamp);
  }

  #start(q: Queue): Promise<void> {
    this.queue.value = q;
    this.#failures = 0;
    return this.#playCurrent();
  }

  /** A change to the queue that keeps the playing song playing. */
  #edit(q: Queue): void {
    if (q === this.queue.peek()) return;
    this.queue.value = q;
    this.#requeue();
  }

  /** The song after this one may have changed: take back what was handed to the engine, and look again. */
  #requeue(): void {
    const ahead = this.#ahead;
    if (ahead?.queued && ahead.path !== following(this.queue.peek())) {
      this.#options.engine.clearNext();
      this.#ahead = { ...ahead, queued: false };
    }
    this.#prepare();
  }

  /** Decodes the song after this one once it's near, and hands it to the engine. */
  #prepare(): void {
    if (!this.#decoded || this.state.peek() === 'loading') return;
    const path = following(this.queue.peek());
    if (path === undefined) return;
    const left = this.#decoded.duration - this.#options.engine.position();
    if (left > PRELOAD_AHEAD) return;
    const ahead = this.#ahead;
    if (ahead?.path === path) {
      if (!ahead.queued && ahead.decoded) this.#queue(path, ahead.decoded);
      return;
    }
    // Loop This Song, or the same song twice in a row: the buffer is already here.
    if (path === this.currentPath.peek()) {
      this.#queue(path, this.#decoded);
      return;
    }
    this.#ahead = { path, decoded: null, queued: false };
    void this.#decodeAhead(path);
  }

  async #decodeAhead(path: string): Promise<void> {
    const load = this.#load;
    const song = this.#options.song(path);
    try {
      if (!song) return;
      const bytes = await this.#options.bytes(path);
      if (load !== this.#load || this.#ahead?.path !== path) return;
      const decoded = await this.#options.engine.decode(bytes, song);
      if (load !== this.#load || this.#ahead?.path !== path) return;
      this.#ahead = { path, decoded, queued: false };
      if (following(this.queue.peek()) === path) this.#queue(path, decoded);
    } catch {
      // When the playing song ends, the player loads this one the usual way and says why it can't play.
      if (this.#ahead?.path === path) this.#ahead = { path, decoded: null, queued: false };
    }
  }

  #queue(path: string, decoded: DecodedSong): void {
    const song = this.#options.song(path);
    const playing = this.currentSong.peek();
    const fade = song && playing ? crossfadeFor(playing, song, this.#settings().crossfade) : 0;
    this.#options.engine.queueNext(decoded, this.#gain(song), fade);
    this.#ahead = { path, decoded, queued: true };
  }

  /** The engine moved on to the song handed to it. */
  #advanced(): void {
    const ahead = this.#ahead;
    const q = next(this.queue.peek(), true);
    this.#ahead = null;
    if (!q || !ahead?.decoded) return void this.#ended();
    this.queue.value = q;
    this.#decoded = ahead.decoded;
    this.#failures = 0;
    this.duration.value = ahead.decoded.duration;
    this.position.value = this.#options.engine.position();
    this.state.value = 'playing';
    this.started.value++;
  }

  async #playCurrent(from = 0): Promise<void> {
    const path = current(this.queue.peek());
    if (path === undefined) return this.#end();
    const load = ++this.#load;
    const song = this.#options.song(path);
    const ahead = this.#ahead;
    this.#ahead = null;
    const ready = ahead?.path === path ? ahead.decoded : null;
    // With the song already decoded, `play` fades the old one out as the new one starts; else silence while loading.
    if (!ready) this.#options.engine.stop();
    else this.#options.engine.clearNext();
    this.#decoded = null;
    this.state.value = 'loading';
    this.position.value = from;
    this.duration.value = song?.duration ?? 0;
    let decoded: DecodedSong;
    try {
      if (!song) throw new Gone();
      if (ready) decoded = ready;
      else {
        const bytes = await this.#options.bytes(path);
        if (load !== this.#load) return;
        decoded = await this.#options.engine.decode(bytes, song);
      }
    } catch (e) {
      if (load !== this.#load) return;
      return this.#failed(song?.title ?? path, e);
    }
    if (load !== this.#load) return;
    this.#failures = 0;
    this.#decoded = decoded;
    this.duration.value = decoded.duration;
    const at = Math.min(from, decoded.duration);
    this.#options.engine.play(decoded, at, this.#gain(song));
    this.position.value = at;
    this.state.value = 'playing';
    this.started.value++;
    this.#prepare();
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
    const q = next(this.queue.peek(), true);
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
    // Paused, not just silent, so Now Playing shows Play.
    void this.#options.engine.pause();
    this.#decoded = null;
    this.#ahead = null;
    this.position.value = 0;
    this.state.value = this.queue.peek().items.length > 0 ? 'paused' : 'stopped';
  }
}

class Gone extends Error {}
