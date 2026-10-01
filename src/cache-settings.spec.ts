import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CACHE_TTL_HOURS,
  cacheDirectory,
  isNoCacheEnv,
  parseTtlHours,
} from './cache-settings.js';

describe('parseTtlHours', () => {
  it('defaults to 24 hours', () => {
    expect(DEFAULT_CACHE_TTL_HOURS).toBe(24);
    expect(parseTtlHours(undefined)).toBe(24);
  });

  it.each(['', '  ', 'abc', '-1', 'Infinity'])(
    'falls back to 24 for %o',
    (raw) => {
      expect(parseTtlHours(raw)).toBe(24);
    },
  );

  it.each([
    ['0', 0],
    ['6', 6],
    [' 1.5 ', 1.5],
  ])('reads %o as %d', (raw, hours) => {
    expect(parseTtlHours(raw)).toBe(hours);
  });
});

describe('cacheDirectory', () => {
  it('uses $XDG_CACHE_HOME when it is an absolute path', () => {
    expect(
      cacheDirectory(
        { XDG_CACHE_HOME: '/Users/example/.xdg' },
        '/Users/example',
      ),
    ).toBe('/Users/example/.xdg/macos-autostart');
  });

  it.each([undefined, '', '  ', 'relative/dir'])(
    'falls back to ~/.cache for XDG_CACHE_HOME=%o',
    (value) => {
      expect(cacheDirectory({ XDG_CACHE_HOME: value }, '/Users/example')).toBe(
        '/Users/example/.cache/macos-autostart',
      );
    },
  );
});

describe('isNoCacheEnv', () => {
  it('is true only for NO_CACHE=true', () => {
    expect(isNoCacheEnv({ NO_CACHE: 'true' })).toBe(true);
    expect(isNoCacheEnv({ NO_CACHE: ' TRUE ' })).toBe(true);
    expect(isNoCacheEnv({ NO_CACHE: 'false' })).toBe(false);
    expect(isNoCacheEnv({ NO_CACHE: '' })).toBe(false);
    expect(isNoCacheEnv({})).toBe(false);
  });
});
