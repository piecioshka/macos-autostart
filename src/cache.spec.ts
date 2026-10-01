import { describe, expect, it } from 'vitest';

import { fakeContext, type FakeSystem } from './__fixtures__/fake-context.js';
import { isFresh, readCache, writeCache, type CacheEntry } from './cache.js';

const DIR = '/Users/example/.cache/macos-autostart';
const FILE = `${DIR}/example.json`;
const NOW = Date.UTC(2026, 8, 29, 12);
const HOUR = 3_600_000;

const ENTRY: CacheEntry = {
  command: 'example --dump',
  savedAt: NOW - HOUR,
  stdout: 'output\n',
};

describe('readCache', () => {
  it('reads an entry from the cache directory', async () => {
    const ctx = fakeContext({ files: { [FILE]: JSON.stringify(ENTRY) } });
    expect(await readCache(ctx, 'example.json')).toEqual(ENTRY);
  });

  it('treats a missing file as no cache', async () => {
    expect(await readCache(fakeContext(), 'example.json')).toBeNull();
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['broken JSON', '{'],
    ['a string', '"text"'],
    ['missing stdout', JSON.stringify({ ...ENTRY, stdout: undefined })],
    ['missing savedAt', JSON.stringify({ ...ENTRY, savedAt: undefined })],
    ['stdout of the wrong type', JSON.stringify({ ...ENTRY, stdout: 1 })],
    ['savedAt of the wrong type', JSON.stringify({ ...ENTRY, savedAt: 'x' })],
  ])('treats %s as no cache', async (_name, content) => {
    const ctx = fakeContext({ files: { [FILE]: content } });
    expect(await readCache(ctx, 'example.json')).toBeNull();
  });

  it('fills in an empty command instead of failing', async () => {
    const content = JSON.stringify({ savedAt: 1, stdout: 'x' });
    const ctx = fakeContext({ files: { [FILE]: content } });
    expect(await readCache(ctx, 'example.json')).toEqual({
      command: '',
      savedAt: 1,
      stdout: 'x',
    });
  });
});

describe('isFresh', () => {
  const ctx = (cacheTtlHours: number) =>
    fakeContext({ now: NOW, cacheTtlHours });

  it('keeps an entry younger than the TTL', () => {
    expect(isFresh(ctx(24), { ...ENTRY, savedAt: NOW - 23 * HOUR })).toBe(true);
  });

  it('drops an entry as old as the TTL or older', () => {
    expect(isFresh(ctx(24), { ...ENTRY, savedAt: NOW - 24 * HOUR })).toBe(
      false,
    );
    expect(isFresh(ctx(6), { ...ENTRY, savedAt: NOW - 7 * HOUR })).toBe(false);
  });

  it('keeps every entry forever with TTL 0', () => {
    expect(isFresh(ctx(0), { ...ENTRY, savedAt: 0 })).toBe(true);
  });

  it('drops an entry saved in the future', () => {
    expect(isFresh(ctx(24), { ...ENTRY, savedAt: NOW + HOUR })).toBe(false);
  });
});

describe('writeCache', () => {
  it('creates the directory and writes a private JSON file', async () => {
    const system: FakeSystem = {};
    const warnings = await writeCache(
      fakeContext(system),
      'example.json',
      ENTRY,
    );
    expect(warnings).toEqual([]);
    expect(system.dirs?.[DIR]).toEqual([]);
    expect(JSON.parse(system.files?.[FILE] ?? '')).toEqual(ENTRY);
    expect(system.modes?.[FILE]).toBe(0o600);
  });

  it('turns a failed write into a warning instead of throwing', async () => {
    const system: FakeSystem = { writeError: 'EACCES: permission denied' };
    const warnings = await writeCache(
      fakeContext(system),
      'example.json',
      ENTRY,
    );
    expect(warnings).toEqual([
      `[cache] could not save ${FILE}: EACCES: permission denied`,
    ]);
    expect(system.files?.[FILE]).toBeUndefined();
  });
});
