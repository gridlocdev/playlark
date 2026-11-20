/** Media keys, the macOS Now Playing widget and the phone's lock screen (PRD §15), through `navigator.mediaSession`. */
import { effect } from '@preact/signals';
import { SEEK_STEP, type CommandCatalog } from '@playlark/ui';
import type { AppController } from './controller.ts';

export function startMediaSession(app: AppController, catalog: CommandCatalog): () => void {
  const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  if (!session) return () => {};
  const player = app.player;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => player.state.peek() !== 'playing' && catalog.run('controls.playPause')],
    ['pause', () => player.state.peek() === 'playing' && catalog.run('controls.playPause')],
    ['stop', () => player.stop()],
    ['nexttrack', () => catalog.run('controls.next')],
    ['previoustrack', () => catalog.run('controls.previous')],
    ['seekforward', (d) => void player.seekBy(d.seekOffset ?? SEEK_STEP)],
    ['seekbackward', (d) => void player.seekBy(-(d.seekOffset ?? SEEK_STEP))],
    ['seekto', (d) => d.seekTime !== undefined && void player.seek(d.seekTime)],
  ];
  for (const [action, run] of handlers) setHandler(session, action, run);
  const stopSong = effect(() => {
    const song = player.currentSong.value;
    session.metadata = song
      ? new MediaMetadata({ title: song.title, artist: song.artist, album: song.album })
      : null;
  });
  const stopState = effect(() => {
    const state = player.state.value;
    session.playbackState = state === 'playing' ? 'playing' : state === 'paused' ? 'paused' : 'none';
  });
  const stopPosition = effect(() => {
    const duration = player.duration.value;
    const position = player.position.value;
    // The position is clamped, so the browser takes it: it throws only on a position past the end.
    if (duration > 0)
      session.setPositionState({
        duration,
        position: Math.max(0, Math.min(position, duration)),
        playbackRate: 1,
      });
  });
  return () => {
    stopSong();
    stopState();
    stopPosition();
  };
}

/** Sets one action's handler; false when this browser doesn't know the action (it throws a TypeError). */
function setHandler(
  session: MediaSession,
  action: MediaSessionAction,
  run: MediaSessionActionHandler,
): boolean {
  try {
    session.setActionHandler(action, run);
    return true;
  } catch {
    return false;
  }
}
