/**
 * The gapless join check (PRD §8.3, §21), run in a real browser by e2e/gapless.spec.ts. Two halves of one sine are
 * read with the app's own tag reader, decoded and scheduled back to back by the app's own engine into an
 * `OfflineAudioContext`, and the rendering is compared with the unbroken sine sample by sample.
 */
import { memorySource, readTags, songFrom, type Song } from '@playlark/core';
import { WebAudioEngine, type EngineContext } from '@playlark/ui';

/** The fixtures: a 440 Hz sine at ffmpeg's level of 1/8, 44.1 kHz, cut at JOIN_FRAME. */
const RATE = 44_100;
const FREQUENCY = 440;
const LEVEL = 1 / 8;
const JOIN_FRAME = 66_150;
const TOTAL_FRAMES = 132_300;
/** Skips the engine's 10 ms fade-in at the start and the song's end. */
const EDGE = 2_205;
/** How far either side of the join counts as "at the join": 50 ms. */
const NEAR = 2_205;
const MAX_LAG = 64;

export interface JoinResult {
  /** Each half's length in frames, once trimmed. */
  readonly frames: readonly [number, number];
  /** The largest difference from the unbroken sine within 50 ms of the join. */
  readonly errorAtJoin: number;
  /** The largest difference anywhere but the very start and end. */
  readonly errorElsewhere: number;
  /** How many frames the second half sits away from where it belongs (0 when sample-exact). */
  readonly lag: number;
}

async function load(url: string): Promise<{ bytes: ArrayBuffer; song: Song }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = await response.arrayBuffer();
  const path = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
  const read = await readTags(memorySource(new Uint8Array(bytes)), path);
  if (!read.ok) throw new Error(`${path}: ${read.error}`);
  return { bytes, song: songFrom({ path, size: bytes.byteLength, mtime: 0 }, read) };
}

const sine = (n: number) => LEVEL * Math.sin((2 * Math.PI * FREQUENCY * n) / RATE);

async function join(first: string, second: string): Promise<JoinResult> {
  const offline = new OfflineAudioContext(1, TOTAL_FRAMES + RATE / 10, RATE);
  const context: EngineContext = {
    get currentTime() {
      return offline.currentTime;
    },
    createGain: () => offline.createGain(),
    createBufferSource: () => offline.createBufferSource(),
    decodeAudioData: (bytes) => offline.decodeAudioData(bytes),
    // The offline context runs only while it renders.
    suspend: () => Promise.resolve(),
    resume: () => Promise.resolve(),
  };
  const engine = new WebAudioEngine(context, {
    node: offline.destination,
    play: () => Promise.resolve(),
    pause: () => {},
  });
  const [a, b] = await Promise.all([load(first), load(second)]);
  const decodedA = await engine.decode(a.bytes, a.song);
  const decodedB = await engine.decode(b.bytes, b.song);
  engine.play(decodedA, 0, 1);
  engine.queueNext(decodedB, 1, 0);
  const out = (await offline.startRendering()).getChannelData(0);

  const errorOver = (from: number, to: number) => {
    let max = 0;
    for (let n = from; n < to; n++) max = Math.max(max, Math.abs(out[n]! - sine(n)));
    return max;
  };
  let lag = 0;
  let best = Infinity;
  for (let l = -MAX_LAG; l <= MAX_LAG; l++) {
    let sum = 0;
    for (let n = JOIN_FRAME + NEAR; n < JOIN_FRAME + 4 * NEAR; n++) sum += (out[n]! - sine(n - l)) ** 2;
    if (sum < best) [best, lag] = [sum, l];
  }
  return {
    frames: [Math.round(decodedA.duration * RATE), Math.round(decodedB.duration * RATE)],
    errorAtJoin: errorOver(JOIN_FRAME - NEAR, JOIN_FRAME + NEAR),
    errorElsewhere: Math.max(
      errorOver(EDGE, JOIN_FRAME - NEAR),
      errorOver(JOIN_FRAME + NEAR, TOTAL_FRAMES - EDGE),
    ),
    lag,
  };
}

Object.assign(window, { playlarkJoin: join });
