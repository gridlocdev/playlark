import { describe, expect, it } from 'vitest';
import { encodePath, formatTime, rangeSource } from '../src/index.ts';

/** A fake server holding `bytes`, answering Range requests and counting them. */
function server(bytes: Uint8Array, honourRange = true) {
  const requests: string[] = [];
  const fetcher = ((_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('Range') ?? '';
    requests.push(range);
    const m = /bytes=(\d+)-(\d+)/.exec(range);
    if (!m || !honourRange) return Promise.resolve(new Response(bytes.slice(), { status: 200 }));
    return Promise.resolve(new Response(bytes.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 }));
  }) as typeof fetch;
  return { fetcher, requests };
}

describe('reading a file over HTTP', () => {
  const bytes = new Uint8Array(200_000).map((_, i) => i % 251);

  it('reads ranges across blocks and fetches each block once', async () => {
    const { fetcher, requests } = server(bytes);
    const source = rangeSource('/f', bytes.length, fetcher);
    expect(await source.read(65_530, 12)).toEqual(bytes.slice(65_530, 65_542));
    expect(await source.read(10, 4)).toEqual(bytes.slice(10, 14));
    expect(requests).toEqual(['bytes=0-65535', 'bytes=65536-131071']);
    expect(await source.read(199_990, 100)).toEqual(bytes.slice(199_990));
    expect(await source.read(300_000, 10)).toEqual(new Uint8Array());
  });

  it('copes with a server that ignores Range', async () => {
    const { fetcher } = server(bytes, false);
    const source = rangeSource('/f', bytes.length, fetcher);
    expect(await source.read(70_000, 5)).toEqual(bytes.slice(70_000, 70_005));
  });

  it('escapes each part of a path', () => {
    expect(encodePath('Café/#1 Song?.mp3')).toBe('Caf%C3%A9/%231%20Song%3F.mp3');
  });

  it('formats times', () => {
    expect(formatTime(7.9)).toBe('0:07');
    expect(formatTime(205)).toBe('3:25');
    expect(formatTime(3723)).toBe('1:02:03');
    expect(formatTime(NaN)).toBe('0:00');
  });
});
