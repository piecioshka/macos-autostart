import { join } from 'node:path';

import { errorMessage } from './exec.js';
import type { Context } from './types.js';

/** Cached output of one command, stored as JSON in `Context.cacheDir`. */
export interface CacheEntry {
  command: string;
  /** When the output was saved, in milliseconds since the epoch. */
  savedAt: number;
  stdout: string;
}

const MS_PER_HOUR = 3_600_000;
/** The cache lists the user's installed apps, so only the owner may read it. */
const FILE_MODE = 0o600;

function toEntry(value: unknown): CacheEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  if (
    !('stdout' in value) ||
    typeof value.stdout !== 'string' ||
    !('savedAt' in value) ||
    typeof value.savedAt !== 'number'
  ) {
    return null;
  }
  const command =
    'command' in value && typeof value.command === 'string'
      ? value.command
      : '';
  return { command, savedAt: value.savedAt, stdout: value.stdout };
}

/** Reads a cache file. Missing, unreadable or malformed files mean "no cache", never an error. */
export async function readCache(
  ctx: Context,
  name: string,
): Promise<CacheEntry | null> {
  try {
    const content = await ctx.fs.readFile(join(ctx.cacheDir, name));
    return toEntry(JSON.parse(content));
  } catch {
    return null;
  }
}

/** True while the entry is younger than `Context.cacheTtlHours` (TTL 0 keeps it forever). */
export function isFresh(ctx: Context, entry: CacheEntry): boolean {
  if (ctx.cacheTtlHours === 0) {
    return true;
  }
  const age = ctx.now() - entry.savedAt;
  return age >= 0 && age < ctx.cacheTtlHours * MS_PER_HOUR;
}

/** Saves an entry. A failed write does not fail the run: it comes back as a warning. */
export async function writeCache(
  ctx: Context,
  name: string,
  entry: CacheEntry,
): Promise<string[]> {
  const path = join(ctx.cacheDir, name);
  try {
    await ctx.fs.mkdir(ctx.cacheDir);
    await ctx.fs.writeFile(path, `${JSON.stringify(entry)}\n`, FILE_MODE);
    return [];
  } catch (error) {
    return [`[cache] could not save ${path}: ${errorMessage(error)}`];
  }
}
