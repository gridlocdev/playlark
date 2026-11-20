import { formatTime, Icon, type CommandCatalog } from '@playlark/ui';
import type { AppController } from './controller.ts';

/** The now-playing bar (PRD §8.1): the song, the transport buttons, the seek bar, the volume and the queue. */
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
  const button = (id: string, icon: string, label: string, extra = '') => {
    const c = catalog.get(id)!;
    const keys = catalog.keys(c).join(' ');
    return (
      <button
        type="button"
        class={`pl-icon-button ${extra}`}
        aria-label={label}
        title={keys ? `${label} (${keys})` : label}
        disabled={!catalog.isEnabled(c)}
        onClick={() => catalog.run(id)}
      >
        <Icon name={icon} />
      </button>
    );
  };
  return (
    <section class="pl-now" aria-label="Now playing">
      <div class="pl-now-song">
        <div class="pl-now-cover" aria-hidden="true">
          {app.nowCover.value ? <img src={app.nowCover.value} alt="" /> : <Icon name="music" />}
        </div>
        <div class="pl-now-text">
          <div class="pl-now-title">{state === 'loading' ? 'Loading…' : (song?.title ?? 'Not playing')}</div>
          <div class="pl-now-artist">{song?.artist ?? ''}</div>
        </div>
      </div>
      <div class="pl-now-middle">
        <div class="pl-transport">
          {button('controls.previous', 'skip-back', 'Previous')}
          {button(
            'controls.playPause',
            state === 'loading' ? 'spinner' : state === 'playing' ? 'pause' : 'play',
            state === 'playing' ? 'Pause' : 'Play',
            `pl-play${state === 'loading' ? ' pl-loading' : ''}`,
          )}
          {button('controls.next', 'skip-forward', 'Next')}
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
          class="pl-icon-button"
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
