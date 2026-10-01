import { isAbsolute, join } from 'node:path';

export type Env = Record<string, string | undefined>;

/** How long a cached `sfltool dumpbtm` result stays valid when CACHE_TTL_HOURS is not set. */
export const DEFAULT_CACHE_TTL_HOURS = 24;

const CACHE_NAME = 'macos-autostart';

/** `$XDG_CACHE_HOME/macos-autostart`, or `~/.cache/macos-autostart` (relative XDG paths are ignored, as the spec says). */
export function cacheDirectory(env: Env, home: string): string {
  const xdg = env.XDG_CACHE_HOME?.trim();
  const base = xdg && isAbsolute(xdg) ? xdg : join(home, '.cache');
  return join(base, CACHE_NAME);
}

/** Reads CACHE_TTL_HOURS: `0` keeps the cache forever, empty, invalid or negative values mean the default. */
export function parseTtlHours(raw: string | undefined): number {
  const text = raw?.trim();
  if (!text) {
    return DEFAULT_CACHE_TTL_HOURS;
  }
  const hours = Number(text);
  return Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_CACHE_TTL_HOURS;
}

export function isNoCacheEnv(env: Env): boolean {
  return env.NO_CACHE?.trim().toLowerCase() === 'true';
}
