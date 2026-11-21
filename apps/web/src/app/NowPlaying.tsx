import { useState } from 'preact/hooks';
import { formatTime, Icon, type CommandCatalog } from '@playlark/ui';
import type { AppController } from './controller.ts';
import { Heart } from './SongList.tsx';

/**
 * The now-playing bar (PRD §8.1): the song, the transport buttons, the seek bar, the heart, the volume and the queue.
 * Below 700 px it is a mini bar that opens into a full-screen player (§18.5).
 */
export function NowPlaying({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const player = app.player;
  const song = player.currentSong.value;
  const state = player.state.value;
  const position = player.position.value;
  const duration = player.duration.value;
  const volume = player.volume.value;
  const repeat = player.repeat.value;
  const [open, setOpen] = useState(false);
  const button = (id: string, icon: string, label: string, extra = '', pressed?: boolean) => {
    const c = catalog.get(id)!;
    const keys = catalog.keys(c).join(' ');
    return (
      <button
        type="button"
        class={`pl-icon-button ${extra}`}
        aria-label={label}
        aria-pressed={pressed}
        title={keys ? `${label} (${keys})` : label}
        disabled={!catalog.isEnabled(c)}
        onClick={() => catalog.run(id)}
      >
        <Icon name={icon} />
      </button>
    );
  };
  return (
    <section class={open ? 'pl-now pl-now-open' : 'pl-now'} aria-label="Now playing">
      <button
        type="button"
        class="pl-icon-button pl-phone-only pl-now-close"
        aria-label="Close Player"
        onClick={() => setOpen(false)}
      >
        <Icon name="chevron-down" />
      </button>
      <div class="pl-now-song">
        <button
          type="button"
          class="pl-now-cover"
          aria-label={song ? `Go to ${song.album}` : 'Not playing'}
          disabled={!song}
          onClick={() => song && app.goToAlbum(song)}
        >
          {app.nowCover.value ? <img src={app.nowCover.value} alt="" /> : <Icon name="music" />}
        </button>
        <div class="pl-now-text">
          {song && state !== 'loading' ? (
            <button type="button" class="pl-now-title pl-link" onClick={() => app.goToAlbum(song)}>
              {song.title}
            </button>
          ) : (
            <div class="pl-now-title">{state === 'loading' ? 'Loading…' : 'Not playing'}</div>
          )}
          {song ? (
            <button type="button" class="pl-now-artist pl-link" onClick={() => app.goToArtist(song)}>
              {song.artist}
            </button>
          ) : (
            <div class="pl-now-artist" />
          )}
        </div>
      </div>
      <div class="pl-now-middle">
        <div class="pl-transport">
          {button('controls.shuffle', 'shuffle', 'Shuffle', 'pl-toggle', player.shuffle.value)}
          {button('controls.previous', 'skip-back', 'Previous')}
          {button(
            'controls.playPause',
            state === 'loading' ? 'spinner' : state === 'playing' ? 'pause' : 'play',
            state === 'playing' ? 'Pause' : 'Play',
            `pl-play${state === 'loading' ? ' pl-loading' : ''}`,
          )}
          {button('controls.next', 'skip-forward', 'Next')}
          {button(
            'controls.repeat',
            repeat === 'one' ? 'repeat-1' : 'repeat',
            repeat === 'one' ? 'Repeat One' : repeat === 'all' ? 'Repeat All' : 'Repeat',
            'pl-toggle',
            repeat !== 'off',
          )}
        </div>
        <div class="pl-seek">
          <span class="pl-time">{formatTime(position)}</span>
          <input
            type="range"
            aria-label="Position"
            min={0}
            max={duration || 1}
            step={0.1}
            value={position}
            disabled={!duration || state === 'loading'}
            aria-valuetext={`${formatTime(position)} of ${formatTime(duration)}`}
            onInput={(e) => void player.seek(Number(e.currentTarget.value))}
          />
          <span class="pl-time">-{formatTime(Math.max(0, duration - position))}</span>
        </div>
      </div>
      <div class="pl-now-right">
        {song ? (
          <Heart
            on={app.stats.get(song.path).favourite}
            onToggle={() => app.stats.toggleFavourite([song.path])}
          />
        ) : (
          <span class="pl-heart" />
        )}
        <Icon name={volume === 0 ? 'volume-x' : 'volume'} />
        <input
          type="range"
          class="pl-volume"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-valuetext={`${Math.round(volume * 100)}%`}
          onInput={(e) => player.setVolume(Number(e.currentTarget.value))}
        />
        <button
          type="button"
          class="pl-icon-button pl-phone-only pl-now-expand"
          aria-label="Open Player"
          onClick={() => setOpen(true)}
        >
          <Icon name="chevron-up" />
        </button>
        <button
          type="button"
          class="pl-icon-button pl-now-queue"
          aria-label="Queue"
          aria-pressed={app.queueShown.value}
          title={`Queue (${catalog.keys(catalog.get('view.queue')!).join(' ')})`}
          onClick={() => catalog.run('view.queue')}
        >
          <Icon name="queue" />
        </button>
      </div>
    </section>
  );
}
