import { describe, expect, it } from 'vitest';
import type { Song } from '@playlark/core';
import { type AudioEngine, type DecodedSong, Player } from '../src/index.ts';

/** An engine that decodes instantly: a file whose first byte is 0 is one it "can't play". */
class FakeEngine implements AudioEngine {
  onEnded: (() => void) | null = null;
  onBlocked: (() => void) | null = null;
  playing: { song: DecodedSong & { path: string }; offset: number } | null = null;
  paused = false;
  at = 0;
  volume = -1;
  decode(bytes: ArrayBuffer): Promise<DecodedSong> {
    const b = new Uint8Array(bytes);
    if (b[0] === 0) return Promise.reject(new Error('EncodingError'));
    return Promise.resolve({ duration: b.length, path: new TextDecoder().decode(b) } as DecodedSong);
  }
  start(song: DecodedSong, offset: number) {
    this.playing = { song: song as DecodedSong & { path: string }, offset };
    this.at = offset;
    this.paused = false;
  }
  pause() {
    this.paused = true;
    return Promise.resolve();
  }
  resume() {
    this.paused = false;
    return Promise.resolve();
  }
  stop() {
    this.playing = null;
  }
  position() {
    return this.at;
  }
  setVolume(v: number) {
    this.volume = v;
  }
  /** The song plays to its end. */
  finish() {
    this.onEnded?.();
  }
}

function setup(unplayable: string[] = []) {
  const engine = new FakeEngine();
  const said: string[] = [];
  const paths = ['a.mp3', 'b.flac', 'c.ogg', 'd.wav'];
  const songs = new Map(paths.map((p) => [p, { path: p, title: p.toUpperCase(), duration: 5 } as Song]));
  const player = new Player({
    engine,
    bytes: (path) =>
      Promise.resolve(
        unplayable.includes(path) ? new Uint8Array([0]).buffer : new TextEncoder().encode(path).buffer,
      ),
    song: (path) => songs.get(path),
    say: (text) => said.push(text),
    volume: 0.5,
  });
  return { engine, player, paths, said };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the player', () => {
  it('plays from the chosen song and moves through the queue', async () => {
    const { engine, player, paths } = setup();
    await player.playFrom(paths, 1);
    expect(player.currentPath.value).toBe('b.flac');
    expect(player.state.value).toBe('playing');
    expect(engine.playing?.song.path).toBe('b.flac');
    await player.next();
    expect(engine.playing?.song.path).toBe('c.ogg');
    engine.finish();
    await settle();
    expect(player.currentPath.value).toBe('d.wav');
  });

  it('jumps to a song in the queue, keeping the queue', async () => {
    const { engine, player, paths } = setup();
    await player.playFrom(paths, 0);
    await player.jumpTo(2);
    expect(engine.playing?.song.path).toBe('c.ogg');
    expect(player.queue.value.items).toEqual(paths);
    await player.jumpTo(9);
    expect(player.currentPath.value).toBe('c.ogg');
  });

  it('pauses and says so when the browser keeps the sound off', async () => {
    const { engine, player, paths, said } = setup();
    await player.playFrom(paths, 0);
    engine.onBlocked?.();
    expect(player.state.value).toBe('paused');
    expect(engine.paused).toBe(true);
    expect(said).toEqual(['The browser kept the sound off. Press Play to start it.']);
    await player.toggle();
    expect(player.state.value).toBe('playing');
  });

  it('stops paused at the start of the last song when the queue ends', async () => {
    const { engine, player, paths } = setup();
    await player.playFrom(paths, 3);
    engine.finish();
    await settle();
    expect(player.currentPath.value).toBe('d.wav');
    expect(player.state.value).toBe('paused');
    expect(player.position.value).toBe(0);
    // Play from there plays the last song again.
    await player.toggle();
    expect(player.state.value).toBe('playing');
  });

  it('restarts the song when Previous comes more than 3 s in, else goes back', async () => {
    const { engine, player, paths } = setup();
    await player.playFrom(paths, 2);
    engine.at = 4;
    await player.previous();
    expect(player.currentPath.value).toBe('c.ogg');
    expect(engine.playing?.offset).toBe(0);
    engine.at = 1;
    await player.previous();
    expect(player.currentPath.value).toBe('b.flac');
  });

  it('pauses and resumes', async () => {
    const { engine, player, paths } = setup();
    await player.playFrom(paths, 0);
    await player.toggle();
    expect(player.state.value).toBe('paused');
    expect(engine.paused).toBe(true);
    await player.toggle();
    expect(player.state.value).toBe('playing');
    expect(engine.paused).toBe(false);
  });

  it('seeks inside the song', async () => {
    const { engine, player, paths } = setup();
    await player.playFrom(paths, 0);
    engine.at = 2;
    await player.seekBy(10);
    expect(engine.playing?.offset).toBe(5);
    await player.seekBy(-10);
    expect(engine.playing?.offset).toBe(0);
  });

  it('skips a song it can’t play and says so', async () => {
    const { player, paths, said } = setup(['b.flac']);
    await player.playFrom(paths, 1);
    expect(player.currentPath.value).toBe('c.ogg');
    expect(said).toEqual(['Skipped B.FLAC: can’t play this format here.']);
  });

  it('stops after three songs in a row it can’t play', async () => {
    const { player, paths, said } = setup(['a.mp3', 'b.flac', 'c.ogg']);
    await player.playFrom(paths, 0);
    expect(said.at(-1)).toBe('Playback stopped: 3 songs in a row couldn’t be played.');
    expect(player.state.value).not.toBe('playing');
  });

  it('keeps the volume between 0 and 1 and passes it on', async () => {
    const { engine, player } = setup();
    expect(engine.volume).toBe(0.5);
    player.setVolume(1.4);
    expect(player.volume.value).toBe(1);
    player.setVolume(-1);
    expect(engine.volume).toBe(0);
  });
});
