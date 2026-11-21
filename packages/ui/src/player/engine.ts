/**
 * The audio engine (PRD §8.3): decoded songs play from Web Audio buffers, each through its own gain (ReplayGain and
 * crossfades), into a volume gain and straight to the speakers. A hidden `<audio>` element loops silence beside it,
 * so the system sees an `<audio>` element playing (Media Session, PRD §15). The sound never goes through that
 * element: Chromium plays a MediaStream through a buffer that speeds up or slows down to catch up after a stall,
 * which puts the song slightly out of tune. The song after the playing one is scheduled to start on the
 * exact sample the playing one ends, so an album plays without a gap (PRD §8.6). The player talks to the
 * `AudioEngine` interface; tests pass a fake.
 */
import { type Song, type Trim, fadeCurves, trimFor } from '@playlark/core';

export interface AudioEngine {
  /** Decodes a whole file and trims the encoder's silence (PRD §8.6); rejects when this browser can't decode it. */
  decode(bytes: ArrayBuffer, song: Song): Promise<DecodedSong>;
  /** Plays `song` from `offset` seconds at `gain`, replacing whatever was playing and whatever was queued. */
  play(song: DecodedSong, offset: number, gain: number): void;
  /**
   * Schedules `song` to start where the playing one ends, `fade` seconds early with a crossfade, replacing any song
   * queued before. Does nothing with nothing playing.
   */
  queueNext(song: DecodedSong, gain: number, fade: number): void;
  /** Takes back the queued song. */
  clearNext(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Stops and lets every song go. */
  stop(): void;
  /** Seconds into the song playing now. */
  position(): number;
  /** 0 to 1, on a perceptual curve. */
  setVolume(volume: number): void;
  /** The playing song ended and the queued one took over. */
  onAdvance: (() => void) | null;
  /** The playing song reached its end with nothing queued (not when it's stopped). */
  onEnded: (() => void) | null;
  /** Called when the browser refuses to make sound until the user clicks (its autoplay rules). */
  onBlocked: (() => void) | null;
}

export interface DecodedSong {
  /** Seconds, once trimmed. */
  readonly duration: number;
}

/** The gain for a 0–1 volume slider: a cube, so the slider's middle sounds like half volume. */
export function volumeGain(volume: number): number {
  const v = Math.max(0, Math.min(1, volume));
  return v * v * v;
}

/** What the engine needs from a Web Audio context; tests pass a fake that records what was scheduled. */
export interface EngineContext {
  readonly currentTime: number;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer>;
  suspend(): Promise<void>;
  resume(): Promise<void>;
}

/** Where the sound goes and how it's started: the speakers and the page's silent `<audio>` element, or nothing in tests. */
export interface EngineOutput {
  readonly node: AudioNode;
  /** Starts the sound; rejects with `NotAllowedError` while the browser keeps it off. */
  play(): Promise<void>;
}

interface WebSong extends DecodedSong {
  readonly buffer: AudioBuffer;
  readonly trim: Trim;
}

interface Voice {
  readonly song: WebSong;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  /** The song's own level (ReplayGain). */
  readonly level: number;
  /** Context time at which offset 0 of the song plays (or would have). */
  readonly zero: number;
}

/** Chromium gives Media Session controls only to media at least 5 s long. */
const SILENCE_SECONDS = 6;

/** A WAV file of `seconds` of silence: 8-bit mono PCM at `rate`. */
export function silentWav(seconds: number, rate: number): Uint8Array<ArrayBuffer> {
  const frames = Math.round(seconds * rate);
  const wav = new Uint8Array(44 + frames);
  const view = new DataView(wav.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) wav[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, wav.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); // bytes per second
  view.setUint16(32, 1, true); // bytes per frame
  view.setUint16(34, 8, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, frames, true);
  wav.fill(128, 44); // 8-bit PCM is unsigned: 128 is silence.
  return wav;
}

/** A short fade on start, stop and seek so the waveform never jumps (a click). */
export const RAMP = 0.01;
/** Points in a crossfade's gain curves. */
const FADE_STEPS = 64;

export class WebAudioEngine implements AudioEngine {
  onAdvance: (() => void) | null = null;
  onEnded: (() => void) | null = null;
  onBlocked: (() => void) | null = null;
  readonly #context: EngineContext;
  readonly #output: EngineOutput;
  readonly #volume: GainNode;
  #voice: Voice | null = null;
  #next: Voice | null = null;
  #pausedAt: number | null = null;

  constructor(context: EngineContext, output: EngineOutput) {
    this.#context = context;
    this.#output = output;
    this.#volume = context.createGain();
    this.#volume.connect(output.node);
  }

  /** The engine for a page: a new `AudioContext` playing to the speakers, beside a hidden `<audio>` looping silence. */
  static forPage(doc: Document = document): WebAudioEngine {
    // 'playback': a larger buffer, so a busy moment (decoding the next song) doesn't make the sound stutter.
    const context = new AudioContext({ latencyHint: 'playback' });
    const element = doc.createElement('audio');
    element.src = URL.createObjectURL(new Blob([silentWav(SILENCE_SECONDS, 8000)], { type: 'audio/wav' }));
    element.loop = true;
    element.hidden = true;
    doc.body.append(element);
    return new WebAudioEngine(context, { node: context.destination, play: () => element.play() });
  }

  async decode(bytes: ArrayBuffer, song: Song): Promise<DecodedSong> {
    const buffer = await this.#context.decodeAudioData(bytes);
    const trim = trimFor(buffer.length, buffer.sampleRate, song);
    const decoded: WebSong = { duration: trim.duration, buffer, trim };
    return decoded;
  }

  play(song: DecodedSong, offset: number, gain: number): void {
    this.clearNext();
    const now = this.#context.currentTime;
    if (this.#voice) this.#release(this.#voice, now);
    const s = song as WebSong;
    const at = Math.max(0, Math.min(offset, s.duration));
    this.#voice = this.#schedule(s, now, at, gain, true);
    this.#pausedAt = null;
    void this.#context.resume();
    this.#sound();
  }

  queueNext(song: DecodedSong, gain: number, fade: number): void {
    this.clearNext();
    const playing = this.#voice;
    if (!playing) return;
    const end = playing.zero + playing.song.duration;
    const length = Math.max(0, Math.min(fade, end - this.#context.currentTime, song.duration));
    const when = Math.max(this.#context.currentTime, end - length);
    const next = this.#schedule(song as WebSong, when, 0, gain, false);
    if (length > 0) {
      const { out, in: into } = fadeCurves(FADE_STEPS);
      playing.gain.gain.setValueCurveAtTime(
        out.map((v) => v * playing.level),
        when,
        length,
      );
      next.gain.gain.cancelScheduledValues(0);
      next.gain.gain.setValueCurveAtTime(
        into.map((v) => v * gain),
        when,
        length,
      );
    }
    this.#next = next;
  }

  clearNext(): void {
    const next = this.#next;
    this.#next = null;
    if (!next) return;
    this.#drop(next);
    // Take back a crossfade out of the playing song.
    const playing = this.#voice;
    if (playing) {
      const g = playing.gain.gain;
      g.cancelScheduledValues(this.#context.currentTime);
      g.setValueAtTime(playing.level, this.#context.currentTime);
    }
  }

  async pause(): Promise<void> {
    if (this.#pausedAt !== null) return;
    this.#pausedAt = this.position();
    await this.#context.suspend();
  }

  async resume(): Promise<void> {
    if (this.#pausedAt === null) return;
    this.#pausedAt = null;
    await this.#context.resume();
    this.#sound();
  }

  stop(): void {
    this.clearNext();
    if (this.#voice) this.#drop(this.#voice);
    this.#voice = null;
    this.#pausedAt = null;
  }

  position(): number {
    if (this.#pausedAt !== null) return this.#pausedAt;
    const v = this.#voice;
    if (!v) return 0;
    return Math.max(0, Math.min(v.song.duration, this.#context.currentTime - v.zero));
  }

  setVolume(volume: number): void {
    const g = this.#volume.gain;
    const now = this.#context.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(volumeGain(volume), now, RAMP);
  }

  /** A source for `song` that starts at context time `when`, `offset` seconds into the song. */
  #schedule(song: WebSong, when: number, offset: number, level: number, rampIn: boolean): Voice {
    const gain = this.#context.createGain();
    gain.connect(this.#volume);
    if (rampIn) {
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(level, when + RAMP);
    } else gain.gain.setValueAtTime(level, when);
    const source = this.#context.createBufferSource();
    source.buffer = song.buffer;
    source.connect(gain);
    const voice: Voice = { song, source, gain, level, zero: when - offset };
    source.onended = () => this.#ended(voice);
    source.start(when, song.trim.start + offset, song.duration - offset);
    return voice;
  }

  #ended(voice: Voice): void {
    if (this.#voice !== voice) return;
    voice.source.disconnect();
    voice.gain.disconnect();
    const next = this.#next;
    this.#next = null;
    this.#voice = next;
    if (next) this.onAdvance?.();
    else this.onEnded?.();
  }

  /** Fades `voice` out over RAMP from `now`, then lets it go. */
  #release(voice: Voice, now: number): void {
    const g = voice.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(voice.level, now);
    g.linearRampToValueAtTime(0, now + RAMP);
    voice.source.onended = () => {
      voice.source.disconnect();
      voice.gain.disconnect();
    };
    voice.source.stop(now + RAMP);
  }

  #drop(voice: Voice): void {
    voice.source.onended = null;
    voice.source.stop();
    voice.source.disconnect();
    voice.gain.disconnect();
  }

  /** Starts the element that carries the sound; the browser may refuse until the user has clicked. */
  #sound(): void {
    this.#output.play().catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'NotAllowedError') this.onBlocked?.();
      else throw e;
    });
  }
}
