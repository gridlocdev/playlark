import { describe, expect, it } from 'vitest';
import { SHELL_CACHE_PREFIX, answersFromShell, shellCacheName, shellFiles } from '../src/index.ts';

describe('the files kept for offline starts (§18.5)', () => {
  it('keeps the app’s files, never source maps, the worker itself or the API', () => {
    expect(
      shellFiles(['index.html', 'assets/index-a.js', 'assets/index-a.js.map', 'sw.js', 'icon-192.png']),
    ).toEqual(['./', 'assets/index-a.js', 'icon-192.png', 'index.html']);
  });

  it('names a new cache for each build', () => {
    const one = shellCacheName(['./', 'assets/index-a.js']);
    expect(one.startsWith(SHELL_CACHE_PREFIX)).toBe(true);
    expect(shellCacheName(['./', 'assets/index-a.js'])).toBe(one);
    expect(shellCacheName(['./', 'assets/index-b.js'])).not.toBe(one);
  });

  it('answers the app’s own GETs, never music, covers or another site', () => {
    const scope = new URL('https://nas.example/music/');
    const at = (p: string) => new URL(p, scope);
    expect(answersFromShell(at('./'), scope, 'GET')).toBe(true);
    expect(answersFromShell(at('assets/index-a.js'), scope, 'GET')).toBe(true);
    expect(answersFromShell(at('api/media/a.flac'), scope, 'GET')).toBe(false);
    expect(answersFromShell(at('api/covers/abc'), scope, 'GET')).toBe(false);
    expect(answersFromShell(at('./'), scope, 'POST')).toBe(false);
    expect(answersFromShell(new URL('https://other.example/music/'), scope, 'GET')).toBe(false);
    expect(answersFromShell(new URL('https://nas.example/'), scope, 'GET')).toBe(false);
  });
});
