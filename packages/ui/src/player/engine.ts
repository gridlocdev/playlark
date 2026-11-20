/**
 * The audio engine (PRD §8.3): a decoded song plays from a Web Audio buffer through a volume gain into a
 * MediaStream that one hidden `<audio>` element plays, so the system sees an `<audio>` element playing
 * (Media Session, PRD §15). The player talks to the `AudioEngine` interface; tests pass a fake.
 */

export interface AudioEngine {
  /** Decodes a whole file; rejects when this browser can't decode the format. */
  decode(bytes: ArrayBuffer): Promise<DecodedSong>;
  /** Plays `song` from `offset` seconds, replacing whatever was playing. */
  start(song: DecodedSong, offset: number): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Stops and lets the song go. */
  stop(): void;
  /** Seconds into the song playing now. */
  position(): number;
  /** 0 to 1, on a perceptual curve. */
  setVolume(volume: number): void;
  /** Called when the song playing reaches its end (not when it's stopped). */
  onEnded: (() => void) | null;
  /** Called when the browser refuses to make sound until the user clicks (its autoplay rules). */
  onBlocked: (() => void) | null;
}

export interface DecodedSong {
  readonly duration: number;
}

/** The gain for a 0–1 volume slider: a cube, so the slider's middle sounds like half volume. */
export function volumeGain(volume: number): number {
  const v = Math.max(0, Math.min(1, volume));
  return v * v * v;
}

interface WebSong extends DecodedSong {
  readonly buffer: AudioBuffer;
}

/** A short fade on start, pause and seek so the waveform never jumps (a click). */
const RAMP = 0.01;

export class WebAudioEngine implements AudioEngine {
  onEnded: (() => void) | null = null;
  onBlocked: (() => void) | null = null;
  readonly #context: AudioContext;
  readonly #volume: GainNode;
  readonly #element: HTMLAudioElement;
  #source: AudioBufferSourceNode | null = null;
  /** Context time at which offset 0 of the song would have played. */
  #startedAt = 0;
  #pausedAt: number | null = null;
  #song: WebSong | null = null;

  constructor(doc: Document = document) {
    this.#context = new AudioContext();
    this.#volume = this.#context.createGain();
    const out = this.#context.createMediaStreamDestination();
    this.#volume.connect(out);
    this.#element = doc.createElement('audio');
    this.#element.srcObject = out.stream;
    this.#element.hidden = true;
    doc.body.append(this.#element);
  }

  async decode(bytes: ArrayBuffer): Promise<DecodedSong> {
    const buffer = await this.#context.decodeAudioData(bytes);
    const song: WebSong = { duration: buffer.duration, buffer };
    return song;
  }

  start(song: DecodedSong, offset: number): void {
    this.#disconnect();
    const s = song as WebSong;
    this.#song = s;
    const source = this.#context.createBufferSource();
    source.buffer = s.buffer;
    source.connect(this.#volume);
    const at = Math.max(0, Math.min(offset, s.duration));
    source.onended = () => {
      if (this.#source !== source) return;
      this.#source = null;
      this.onEnded?.();
    };
    this.#source = source;
    this.#pausedAt = null;
    this.#startedAt = this.#context.currentTime - at;
    source.start(0, at);
    void this.#context.resume();
    this.#sound();
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

  /** Starts the element that carries the sound; the browser may refuse until the user has clicked. */
  #sound(): void {
    this.#element.play().catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'NotAllowedError') this.onBlocked?.();
      else throw e;
    });
  }

  stop(): void {
    this.#disconnect();
    this.#song = null;
    this.#pausedAt = null;
  }

  position(): number {
    if (this.#pausedAt !== null) return this.#pausedAt;
    if (!this.#song) return 0;
    return Math.max(0, Math.min(this.#song.duration, this.#context.currentTime - this.#startedAt));
  }

  setVolume(volume: number): void {
    const g = this.#volume.gain;
    g.cancelScheduledValues(this.#context.currentTime);
    g.setTargetAtTime(volumeGain(volume), this.#context.currentTime, RAMP);
  }

  #disconnect(): void {
    const s = this.#source;
    this.#source = null;
    if (!s) return;
    s.onended = null;
    // A node stopped twice throws, and a song's node is stopped once: when it's let go, here.
    s.stop();
    s.disconnect();
  }
}
