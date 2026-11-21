import { describe, expect, it } from 'vitest';
import { type Song, current, parseSavedQueue, saveQueue } from '@playlark/core';
import { type AudioEngine, type DecodedSong, PRELOAD_AHEAD, Player } from '../src/index.ts';

type FakeSong = DecodedSong & { path: string };

/** An engine that decodes instantly: a file whose first byte is 0 is one it "can't play". */
class FakeEngine implements AudioEngine {
  onAdvance: (() => void) | null = null;
  onEnded: (() => void) | null = null;
  onBlocked: (() => void) | null = null;
  playing: { song: FakeSong; offset: number; gain: number } | null = null;
  queued: { song: FakeSong; gain: number; fade: number } | null = null;
  decoded: string[] = [];
  paused = false;
  at = 0;
  volume = -1;
  decode(bytes: ArrayBuffer): Promise<DecodedSong> {
    const b = new Uint8Array(bytes);
    if (b[0] === 0) return Promise.reject(new Error('EncodingError'));
    const path = new TextDecoder().decode(b);
    this.decoded.push(path);
    return Promise.resolve({ duration: 100, path } as DecodedSong);
  }
  play(song: DecodedSong, offset: number, gain: number) {
    this.playing = { song: song as FakeSong, offset, gain };
    this.queued = null;
    this.at = offset;
    this.paused = false;
  }
  queueNext(song: DecodedSong, gain: number, fade: number) {
    if (this.playing) this.queued = { song: song as FakeSong, gain, fade };
  }
  clearNext() {
    this.queued = null;
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
    this.queued = null;
  }
  position() {
    return this.at;
  }
  setVolume(v: number) {
    this.volume = v;
  }
  /** The song plays to its end: into the queued one if there is one. */
  finish() {
    const q = this.queued;
    if (q) {
      this.playing = { song: q.song, offset: 0, gain: q.gain };
      this.queued = null;
      this.at = q.fade;
      this.onAdvance?.();
    } else {
      this.playing = null;
      this.onEnded?.();
    }
  }
}

const PATHS = ['a.mp3', 'b.flac', 'c.ogg', 'd.wav'];

function setup(unplayable: string[] = [], crossfade = 0) {
  const engine = new FakeEngine();
  const said: string[] = [];
  const songs = new Map(
    PATHS.map((p, i) => [
      p,
      {
        path: p,
        title: p.toUpperCase(),
        album: `Album ${i}`,
        duration: 100,
        replayGain: { trackGain: -6, albumGain: -20 * Math.log10(2) },
      } as Song,
    ]),
  );
  const player = new Player({
    engine,
    bytes: (path) =>
      Promise.resolve(
        unplayable.includes(path) ? new Uint8Array([0]).buffer : new TextEncoder().encode(path).buffer,
      ),
    song: (path) => songs.get(path),
    say: (text) => said.push(text),
    volume: 0.5,
    playback: () => ({ replayGain: 'album', preamp: 0, crossfade }),
    seed: () => 7,
  });
  return { engine, player, paths: PATHS, said, songs };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** Moves the fake clock to `left` seconds before the end, and lets the player look ahead. */
async function nearEnd(engine: FakeEngine, player: Player, left = 5) {
  engine.at = 100 - left;
  player.tick();
  await settle();
}

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
    engine.at = 95;
    await player.seekBy(10);
    expect(engine.playing?.offset).toBe(100);
    engine.at = 5;
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

  it('plays at the album’s ReplayGain', async () => {
    const { engine, player, paths } = setup();
    await player.playFrom(paths, 0);
    expect(engine.playing?.gain).toBeCloseTo(0.5);
  });
});

describe('gapless playback', () => {
  it('decodes the next song only near the end, and hands it over to start on time', async () => {
    const { engine, player, paths } = setup();
    await player.playFrom(paths, 0);
    player.tick();
    await settle();
    expect(engine.decoded).toEqual(['a.mp3']);
    await nearEnd(engine, player, PRELOAD_AHEAD);
    expect(engine.decoded).toEqual(['a.mp3', 'b.flac']);
    expect(engine.queued).toMatchObject({ song: { path: 'b.flac' }, fade: 0 });
    engine.finish();
    expect(player.currentPath.value).toBe('b.flac');
    expect(player.state.value).toBe('playing');
    // Nothing is decoded twice.
    expect(engine.decoded).toEqual(['a.mp3', 'b.flac']);
  });

  it('takes the handed-over song back when the queue changes under it', async () => {
    const { engine, player, paths } = setup();
    await player.playFrom(paths, 0);
    await nearEnd(engine, player);
    player.playNext(['d.wav']);
    await settle();
    expect(engine.queued?.song.path).toBe('d.wav');
    player.remove([1]);
    await settle();
    expect(engine.queued?.song.path).toBe('b.flac');
    player.clearUpNext();
    expect(engine.queued).toBeNull();
  });

  it('Next by hand uses the song decoded ahead', async () => {
    const { engine, player, paths } = setup();
    await player.playFrom(paths, 0);
    await nearEnd(engine, player);
    await player.next();
    expect(engine.playing?.song.path).toBe('b.flac');
    expect(engine.decoded).toEqual(['a.mp3', 'b.flac']);
  });

  it('Loop This Song plays the same buffer again; Next by hand moves on', async () => {
    const { engine, player, paths } = setup();
    await player.playFrom(paths, 0);
    player.toggleLoopSong();
    expect(player.repeat.value).toBe('one');
    await nearEnd(engine, player);
    expect(engine.queued?.song.path).toBe('a.mp3');
    engine.finish();
    expect(player.currentPath.value).toBe('a.mp3');
    expect(engine.decoded).toEqual(['a.mp3']);
    await player.next();
    expect(player.currentPath.value).toBe('b.flac');
  });

  it('Loop Queue goes back to the first song after the last', async () => {
    const { engine, player, paths } = setup();
    await player.playFrom(paths, 3);
    player.toggleLoopQueue();
    await nearEnd(engine, player);
    engine.finish();
    expect(player.currentPath.value).toBe('a.mp3');
  });

  it('crossfades between songs from different albums', async () => {
    const { engine, player, paths } = setup([], 4);
    await player.playFrom(paths, 0);
    await nearEnd(engine, player);
    expect(engine.queued?.fade).toBe(4);
  });

  it('a song it can’t decode ahead is skipped the usual way when its turn comes', async () => {
    const { engine, player, paths, said } = setup(['b.flac']);
    await player.playFrom(paths, 0);
    await nearEnd(engine, player);
    expect(engine.queued).toBeNull();
    engine.finish();
    await settle();
    expect(player.currentPath.value).toBe('c.ogg');
    expect(said).toEqual(['Skipped B.FLAC: can’t play this format here.']);
  });
});

describe('the queue in the player', () => {
  it('Shuffle keeps the playing song and shuffles the rest; off puts the order back', async () => {
    const { player, paths } = setup();
    await player.playFrom(paths, 1);
    player.toggleShuffle();
    expect(player.shuffle.value).toBe(true);
    expect(player.currentPath.value).toBe('b.flac');
    expect(player.queue.value.items.slice(0, 2)).toEqual(['a.mp3', 'b.flac']);
    player.toggleShuffle();
    expect(player.queue.value.items).toEqual(paths);
  });

  it('Shuffle on a page plays all its songs in a random order', async () => {
    const { player, paths } = setup();
    await player.shuffleAll(paths);
    expect(player.shuffle.value).toBe(true);
    expect([...player.queue.value.items].sort()).toEqual(paths);
    expect(player.state.value).toBe('playing');
  });

  it('Play Next and Add to Queue with nothing playing wait in the queue', () => {
    const { player } = setup();
    player.addToQueue(['a.mp3']);
    player.playNext(['b.flac']);
    expect(player.queue.value.items).toEqual(['a.mp3', 'b.flac']);
    expect(player.state.value).toBe('stopped');
  });

  it('puts back a saved queue, paused, dropping songs that are gone', async () => {
    const { player, paths, songs } = setup();
    await player.playFrom(paths, 2);
    const text = JSON.stringify(saveQueue('/M', player.queue.value, 42));
    songs.delete('a.mp3');
    const gone = player.restore(parseSavedQueue(text, '/M')!);
    expect(gone).toBe(1);
    expect(current(player.queue.value)).toBe('c.ogg');
    expect(player.state.value).toBe('paused');
    expect(player.position.value).toBe(42);
    await player.toggle();
    expect(player.state.value).toBe('playing');
    expect(player.position.value).toBe(42);
  });

  it('stops when the playing song leaves the library', async () => {
    const { player, paths, songs } = setup();
    await player.playFrom(paths, 1);
    songs.delete('b.flac');
    player.prune();
    expect(player.queue.value.items).toEqual(['a.mp3', 'c.ogg', 'd.wav']);
    expect(player.state.value).toBe('paused');
  });
});
