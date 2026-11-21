import { describe, expect, it } from 'vitest';
import type { Song } from '@playlark/core';
import { type EngineContext, RAMP, WebAudioEngine, silentWav } from '../src/index.ts';

/** A gain parameter that records what was scheduled on it. */
class FakeParam {
  value = 1;
  readonly events: [string, ...unknown[]][] = [];
  setValueAtTime(v: number, t: number) {
    this.events.push(['set', v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(['ramp', v, t]);
  }
  setTargetAtTime(v: number, t: number) {
    this.events.push(['target', v, t]);
  }
  setValueCurveAtTime(curve: Float32Array, t: number, d: number) {
    this.events.push(['curve', curve[0], curve.at(-1), t, d]);
  }
  cancelScheduledValues(t: number) {
    this.events.push(['cancel', t]);
  }
}

class FakeNode {
  readonly gain = new FakeParam();
  connect() {}
  disconnect() {}
}

class FakeSource extends FakeNode {
  buffer: { length: number; sampleRate: number } | null = null;
  started: [number, number, number] | null = null;
  stopped: number | null = null;
  onended: (() => void) | null = null;
  start(when: number, offset: number, duration: number) {
    this.started = [when, offset, duration];
  }
  stop(when = 0) {
    this.stopped = when;
  }
}

/** A context whose clock the test moves; each decoded file is 1 s plus 1,000 frames of encoder delay. */
class FakeContext {
  currentTime = 0;
  readonly sources: FakeSource[] = [];
  readonly gains: FakeNode[] = [];
  createGain() {
    const g = new FakeNode();
    this.gains.push(g);
    return g as unknown as GainNode;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s as unknown as AudioBufferSourceNode;
  }
  decodeAudioData() {
    return Promise.resolve({ length: 44100 + 1000, sampleRate: 44100 } as AudioBuffer);
  }
  suspend() {
    return Promise.resolve();
  }
  resume() {
    return Promise.resolve();
  }
}

const SONG = { path: 'a', duration: 1, sampleRate: 44100, encoderDelay: 1000 } as Song;

function setup() {
  const context = new FakeContext();
  const events: string[] = [];
  const element: string[] = [];
  const engine = new WebAudioEngine(context satisfies EngineContext, {
    node: new FakeNode() as unknown as AudioNode,
    play: () => {
      element.push('play');
      return Promise.resolve();
    },
    pause: () => element.push('pause'),
  });
  engine.onAdvance = () => events.push('advance');
  engine.onEnded = () => events.push('ended');
  return { context, engine, events, element };
}

describe('the Web Audio engine', () => {
  it('skips the encoder delay and plays the song’s real length', async () => {
    const { context, engine } = setup();
    const song = await engine.decode(new ArrayBuffer(0), SONG);
    expect(song.duration).toBe(1);
    context.currentTime = 5;
    engine.play(song, 0.25, 0.5);
    expect(context.sources[0]!.started).toEqual([5, 1000 / 44100 + 0.25, 0.75]);
    context.currentTime = 5.5;
    expect(engine.position()).toBeCloseTo(0.75);
  });

  it('starts the next song on the exact time the playing one ends', async () => {
    const { context, engine, events } = setup();
    const song = await engine.decode(new ArrayBuffer(0), SONG);
    context.currentTime = 2;
    engine.play(song, 0.5, 1);
    context.currentTime = 2.2;
    engine.queueNext(song, 0.8, 0);
    const [first, second] = context.sources;
    expect(second!.started).toEqual([2.5, 1000 / 44100, 1]);
    // The playing song ends: the queued one is now the one playing.
    context.currentTime = 2.6;
    first!.onended?.();
    expect(events).toEqual(['advance']);
    expect(engine.position()).toBeCloseTo(0.1);
    second!.onended?.();
    expect(events).toEqual(['advance', 'ended']);
  });

  it('crossfades by starting the next song early, with equal-power curves', async () => {
    const { context, engine } = setup();
    const long = await engine.decode(new ArrayBuffer(0), { ...SONG, duration: 0 } as Song);
    engine.play(long, 0, 1);
    engine.queueNext(long, 0.5, 0.25);
    const [, nextSource] = context.sources;
    const end = 1 + 1000 / 44100;
    expect(nextSource!.started![0]).toBeCloseTo(end - 0.25);
    const [, playingGain, nextGain] = context.gains;
    expect(playingGain!.gain.events.at(-1)).toEqual(['curve', 1, expect.closeTo(0), end - 0.25, 0.25]);
    expect(nextGain!.gain.events.at(-1)).toEqual(['curve', 0, 0.5, end - 0.25, 0.25]);
  });

  it('takes back a queued song and its fade', async () => {
    const { context, engine } = setup();
    const song = await engine.decode(new ArrayBuffer(0), SONG);
    engine.play(song, 0, 0.7);
    engine.queueNext(song, 1, 0.2);
    engine.clearNext();
    expect(context.sources[1]!.stopped).toBe(0);
    expect(context.gains[1]!.gain.events.at(-1)).toEqual(['set', 0.7, 0]);
  });

  it('pauses and plays the element Now Playing follows along with the song', async () => {
    const { engine, element } = setup();
    const song = await engine.decode(new ArrayBuffer(0), SONG);
    engine.play(song, 0, 1);
    await engine.pause();
    await engine.resume();
    await engine.pause();
    engine.play(song, 0, 1);
    expect(element).toEqual(['play', 'pause', 'play', 'pause', 'play']);
  });

  it('a new song fades the old one out over a few milliseconds instead of cutting it', async () => {
    const { context, engine, events } = setup();
    const song = await engine.decode(new ArrayBuffer(0), SONG);
    engine.play(song, 0, 1);
    context.currentTime = 0.4;
    engine.play(song, 0, 1);
    const old = context.sources[0]!;
    expect(old.stopped).toBe(0.4 + RAMP);
    expect(context.gains[1]!.gain.events.at(-1)).toEqual(['ramp', 0, 0.4 + RAMP]);
    old.onended?.();
    expect(events).toEqual([]);
  });
});

describe('silentWav', () => {
  it('is a valid 8-bit mono WAV of silence, long enough for the system to treat it as music', () => {
    const wav = silentWav(6, 8000);
    const view = new DataView(wav.buffer);
    const text = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(8);
    expect(view.getUint32(40, true)).toBe(48_000);
    expect(wav.length).toBe(44 + 48_000);
    expect(wav.subarray(44).every((b) => b === 128)).toBe(true);
  });
});
