import { rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  EXEC_TIMEOUT_MS,
  createExec,
  defaultContext,
  defaultExec,
  defaultFs,
  errorMessage,
  ifExists,
  isMissing,
} from './exec.js';

function enoent(): Error {
  return Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
}

describe('defaultExec', () => {
  it('returns stdout and exit code 0', async () => {
    const result = await defaultExec('/bin/echo', ['hello']);
    expect(result).toEqual({ stdout: 'hello\n', stderr: '', code: 0 });
  });

  it('returns a non-zero exit code instead of throwing', async () => {
    const result = await defaultExec('/bin/sh', [
      '-c',
      'echo oops >&2; exit 3',
    ]);
    expect(result.code).toBe(3);
    expect(result.stderr).toBe('oops\n');
  });

  it('returns 127 when the binary does not exist', async () => {
    const result = await defaultExec('/nonexistent/binary', []);
    expect(result.code).toBe(127);
    expect(result.stderr).toMatch(/ENOENT/);
  });

  it('resolves with a non-zero code when the child is killed', async () => {
    const result = await defaultExec('/bin/sh', ['-c', 'kill -9 $$']);
    expect(result.code).toBe(137);
  });

  it('writes options.input to the child stdin', async () => {
    const result = await defaultExec('/bin/cat', [], { input: 'hello stdin' });
    expect(result).toEqual({ stdout: 'hello stdin', stderr: '', code: 0 });
  });

  it('survives a child that never reads its stdin', async () => {
    const result = await defaultExec('/usr/bin/true', [], {
      input: 'x'.repeat(1_000_000),
    });
    expect(result.code).toBe(0);
  });

  it('returns 127 for a missing binary even with input', async () => {
    const result = await defaultExec('/nonexistent/binary', [], {
      input: 'x',
    });
    expect(result.code).toBe(127);
  });
});

describe('createExec', () => {
  it('gives every command 30 seconds by default', () => {
    expect(EXEC_TIMEOUT_MS).toBe(30_000);
  });

  it('kills a command that runs longer than the timeout', async () => {
    const started = Date.now();
    const result = await createExec(200)('/bin/sleep', ['5']);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.code).toBe(124);
    expect(result.stderr).toBe('/bin/sleep timed out after 0.2 s');
  });

  it('lets one call use its own timeout', async () => {
    const started = Date.now();
    const result = await createExec(30_000)('/bin/sleep', ['5'], {
      timeoutMs: 200,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.code).toBe(124);
    expect(result.stderr).toBe('/bin/sleep timed out after 0.2 s');
  });
});

describe('isMissing', () => {
  it('recognizes ENOENT errors only', () => {
    expect(isMissing(enoent())).toBe(true);
    expect(isMissing(new Error('EACCES'))).toBe(false);
    expect(isMissing('ENOENT')).toBe(false);
  });
});

describe('ifExists', () => {
  it('returns the value when the promise resolves', async () => {
    expect(await ifExists(Promise.resolve('x'), 'fallback')).toBe('x');
  });

  it('returns the fallback for ENOENT', async () => {
    expect(await ifExists(Promise.reject(enoent()), 'fallback')).toBe(
      'fallback',
    );
  });

  it('rethrows other errors', async () => {
    await expect(
      ifExists(Promise.reject(new Error('EACCES')), 'fallback'),
    ).rejects.toThrow('EACCES');
  });
});

describe('errorMessage', () => {
  it('reads Error.message and stringifies anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage(42)).toBe('42');
  });
});

describe('defaultContext', () => {
  it('reads the cache directory and TTL from the environment', () => {
    const ctx = defaultContext({
      XDG_CACHE_HOME: '/Users/example/.xdg',
      CACHE_TTL_HOURS: '6',
    });
    expect(ctx.cacheDir).toBe('/Users/example/.xdg/macos-autostart');
    expect(ctx.cacheTtlHours).toBe(6);
    expect(Math.abs(ctx.now() - Date.now())).toBeLessThan(1000);
  });

  it('defaults to ~/.cache and 24 hours', () => {
    const ctx = defaultContext({});
    expect(ctx.cacheDir).toBe(`${ctx.home}/.cache/macos-autostart`);
    expect(ctx.cacheTtlHours).toBe(24);
  });
});

describe('defaultFs', () => {
  const root = fileURLToPath(new URL('../tmp/exec-spec-fs', import.meta.url));
  const dir = `${root}/nested/dir`;
  const file = `${dir}/entry.json`;

  afterEach(() => rm(root, { recursive: true, force: true }));

  it('creates nested directories and writes a file with the given mode', async () => {
    await defaultFs.mkdir(dir);
    await defaultFs.mkdir(dir);
    await defaultFs.writeFile(file, '{}', 0o600);
    expect(await defaultFs.readFile(file)).toBe('{}');
    expect((await stat(file)).mode.toString(8).slice(-3)).toBe('600');
  });
});
