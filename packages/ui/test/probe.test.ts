import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandCatalog,
  KeyProbe,
  PROBE_IDLE_MS,
  SEQUENCE_MS,
  probeKey,
  startProbe,
  type CommandSpec,
  type ProbeEvent,
  type ProbeResult,
  type ShortcutEvent,
} from '../src/index.ts';

const key = (e: Partial<ShortcutEvent>): ShortcutEvent => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...e,
});

function catalog() {
  const ran: string[] = [];
  const spec = (id: string, shortcuts: string[], more: Partial<CommandSpec> = {}): CommandSpec => ({
    id,
    title: id,
    description: id,
    group: 'Edit',
    shortcuts,
    run: () => void ran.push(id),
    ...more,
  });
  const c = new CommandCatalog([
    spec('menu', ['mod+k'], { global: true }),
    spec('play', ['space']),
    spec('off', ['mod+e'], { enabled: () => false }),
    spec('info', ['g i']),
  ]);
  return { c, ran };
}

const CMD_K = key({ key: 'k', code: 'KeyK', metaKey: true });

/** A keydown as the window sees it. */
function keydown(e: Partial<ShortcutEvent>): ProbeEvent & Event {
  return Object.assign(new Event('keydown', { cancelable: true }), key(e));
}

/**
 * A window with the app's own key listener, like `listenForKeys`. In a browser the probe listens in the capture
 * phase, so it runs first; Node's EventTarget runs listeners in the order they were added, so the probe is
 * started before the app's listener is added.
 */
function page(c: CommandCatalog, onKey: (r: ProbeResult) => void, now = () => 0) {
  const target = new EventTarget();
  type Listener = (e: ProbeEvent) => void;
  const asDom = (l: Listener) => l as unknown as EventListener;
  const keys = {
    addEventListener: (type: 'keydown', l: Listener, o: { capture: boolean }) =>
      target.addEventListener(type, asDom(l), o),
    removeEventListener: (type: 'keydown', l: Listener, o: { capture: boolean }) =>
      target.removeEventListener(type, asDom(l), o),
  };
  const ended: string[] = [];
  const stop = startProbe(keys, c, { onKey, onEnd: () => ended.push('end'), now, mac: true });
  const reached: string[] = [];
  keys.addEventListener('keydown', (e) => reached.push(e.key), { capture: false });
  return { target, stop, ended, reached };
}

describe('Keyboard shortcuts', () => {
  describe('probeKey', () => {
    it('names the command a key runs, even when it is disabled now', () => {
      const { c } = catalog();
      expect(probeKey(c, CMD_K, null, 0, true)).toMatchObject({ kind: 'command', command: { id: 'menu' } });
      expect(probeKey(c, key({ key: 'e', code: 'KeyE', metaKey: true }), null, 0, true)).toMatchObject({
        kind: 'command',
        command: { id: 'off' },
      });
      expect(probeKey(c, key({ key: 'q', code: 'KeyQ' }), null, 0, true)).toEqual({ kind: 'none' });
    });

    it('waits for the second key of a sequence, and forgets it after the sequence time', () => {
      const { c } = catalog();
      const g = probeKey(c, key({ key: 'g', code: 'KeyG' }), null, 0, true);
      expect(g).toMatchObject({ kind: 'first', keys: ['G'] });
      const pending = { first: g.first!, at: 0 };
      const i = key({ key: 'i', code: 'KeyI' });
      expect(probeKey(c, i, pending, 100, true)).toMatchObject({ kind: 'command', command: { id: 'info' } });
      expect(probeKey(c, i, pending, SEQUENCE_MS + 1, true)).toEqual({ kind: 'none' });
    });
  });

  describe('startProbe', () => {
    it('reports each key, runs nothing, and keeps keys from the app', () => {
      const { c, ran } = catalog();
      const seen: ProbeResult[] = [];
      const p = page(c, (r) => seen.push(r));
      const e = keydown({ key: 'k', code: 'KeyK', metaKey: true });
      p.target.dispatchEvent(e);
      p.target.dispatchEvent(keydown({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }));
      expect(e.defaultPrevented).toBe(true);
      expect(seen).toMatchObject([{ kind: 'command', command: { id: 'menu' } }]);
      expect(p.reached).toEqual([]);
      expect(ran).toEqual([]);
    });

    it('finds a two-key sequence across two presses', () => {
      const { c } = catalog();
      const seen: ProbeResult[] = [];
      const p = page(c, (r) => seen.push(r));
      p.target.dispatchEvent(keydown({ key: 'g', code: 'KeyG' }));
      p.target.dispatchEvent(keydown({ key: 'i', code: 'KeyI' }));
      expect(seen).toMatchObject([{ kind: 'first' }, { kind: 'command', command: { id: 'info' } }]);
    });

    it('ends on Escape and lets Escape and every later key through', () => {
      const { c } = catalog();
      const p = page(c, () => {});
      const esc = keydown({ key: 'Escape', code: 'Escape' });
      p.target.dispatchEvent(esc);
      p.target.dispatchEvent(keydown({ key: 'k', code: 'KeyK', metaKey: true }));
      expect(esc.defaultPrevented).toBe(false);
      expect(p.ended).toEqual(['end']);
      expect(p.reached).toEqual(['Escape', 'k']);
    });

    describe('with no key for a while', () => {
      afterEach(() => vi.useRealTimers());

      it('ends on its own and gives the keys back, and each key starts the wait again', () => {
        vi.useFakeTimers();
        const { c } = catalog();
        const p = page(c, () => {});
        vi.advanceTimersByTime(PROBE_IDLE_MS - 1);
        p.target.dispatchEvent(keydown({ key: 'k', code: 'KeyK', metaKey: true }));
        vi.advanceTimersByTime(PROBE_IDLE_MS - 1);
        expect(p.ended).toEqual([]);
        expect(p.reached).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(p.ended).toEqual(['end']);
        p.target.dispatchEvent(keydown({ key: ' ', code: 'Space' }));
        expect(p.reached).toEqual([' ']);
      });

      it('leaves no timer behind once stopped', () => {
        vi.useFakeTimers();
        const { c } = catalog();
        const p = page(c, () => {});
        p.stop();
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(PROBE_IDLE_MS);
        expect(p.ended).toEqual(['end']);
      });

      it('turns the model off when the wait runs out', () => {
        vi.useFakeTimers();
        const { c } = catalog();
        const probe = new KeyProbe();
        probe.start(new EventTarget() as never, c, () => true);
        expect(probe.on.value).toBe(true);
        vi.advanceTimersByTime(PROBE_IDLE_MS);
        expect(probe.on.value).toBe(false);
      });
    });

    it('stops listening when stop is called, once, as when the window closes', () => {
      const { c } = catalog();
      const p = page(c, () => {});
      p.stop();
      p.stop();
      p.target.dispatchEvent(keydown({ key: ' ', code: 'Space' }));
      expect(p.ended).toEqual(['end']);
      expect(p.reached).toEqual([' ']);
    });

    it('ends, and lets the key through, once its window is gone', () => {
      const { c } = catalog();
      let shown = true;
      const reached: string[] = [];
      const target = new EventTarget();
      const keys = {
        addEventListener: (t: 'keydown', l: (e: ProbeEvent) => void, o: { capture: boolean }) =>
          target.addEventListener(t, l as unknown as EventListener, o),
        removeEventListener: (t: 'keydown', l: (e: ProbeEvent) => void, o: { capture: boolean }) =>
          target.removeEventListener(t, l as unknown as EventListener, o),
      };
      const probe = new KeyProbe();
      probe.start(keys, c, () => shown);
      keys.addEventListener('keydown', (e) => reached.push(e.key), { capture: false });
      target.dispatchEvent(keydown({ key: 'k', code: 'KeyK', metaKey: true }));
      expect(probe.result.value).toMatchObject({ kind: 'command', command: { id: 'menu' } });
      expect(reached).toEqual([]);
      shown = false;
      target.dispatchEvent(keydown({ key: 'k', code: 'KeyK', metaKey: true }));
      expect(probe.on.value).toBe(false);
      expect(reached).toEqual(['k']);
    });

    it('removes its listener when handling a key throws, so keys reach the app again', () => {
      const { c } = catalog();
      // A window that reports a listener's error and goes on, as a browser does.
      const listeners: ((e: ProbeEvent) => void)[] = [];
      const errors: unknown[] = [];
      const target = {
        addEventListener: (_: 'keydown', l: (e: ProbeEvent) => void) => void listeners.push(l),
        removeEventListener: (_: 'keydown', l: (e: ProbeEvent) => void) =>
          void listeners.splice(listeners.indexOf(l), 1),
      };
      const dispatch = (e: ProbeEvent & Event) => {
        let stopped = false;
        const stop = e.stopImmediatePropagation.bind(e);
        e.stopImmediatePropagation = () => {
          stopped = true;
          stop();
        };
        for (const l of [...listeners]) {
          if (stopped) break;
          try {
            l(e);
          } catch (err) {
            errors.push(err);
          }
        }
      };
      let calls = 0;
      let ended = 0;
      startProbe(target, c, {
        onKey: () => {
          calls++;
          throw new Error('broken');
        },
        onEnd: () => ended++,
        now: () => 0,
        mac: true,
      });
      const reached: string[] = [];
      target.addEventListener('keydown', (e) => reached.push(e.key));

      dispatch(keydown({ key: 'k', code: 'KeyK', metaKey: true }));
      dispatch(keydown({ key: 'k', code: 'KeyK', metaKey: true }));
      dispatch(keydown({ key: ' ', code: 'Space' }));
      expect(errors).toMatchObject([{ message: 'broken' }]);
      expect(calls).toBe(1);
      expect(ended).toBe(1);
      expect(reached).toEqual(['k', ' ']);
    });
  });
});
