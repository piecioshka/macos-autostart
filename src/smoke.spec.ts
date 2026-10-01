import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { defaultDeps, main } from './cli.js';
import { defaultContext, defaultExec } from './exec.js';
import { collect } from './index.js';
import type { Context, Exec } from './types.js';

/** `sfltool dumpbtm` shows a password dialog on recent macOS, so tests never run it. */
const execWithoutSfltool: Exec = (file, args, options) =>
  file === 'sfltool'
    ? Promise.resolve({ stdout: '', stderr: 'skipped in tests', code: 1 })
    : defaultExec(file, args, options);

/** A cache directory of its own, so the test neither reads nor writes the real cache. */
const CACHE_DIR = fileURLToPath(new URL('../tmp/smoke-cache', import.meta.url));

function smokeContext(): Context {
  return {
    ...defaultContext(),
    exec: execWithoutSfltool,
    cacheDir: CACHE_DIR,
  };
}

describe.skipIf(process.platform !== 'darwin')(
  'smoke test on the real system',
  () => {
    afterAll(() => rm(CACHE_DIR, { recursive: true, force: true }));

    it('prints valid JSON with entries', async () => {
      const chunks: string[] = [];
      const ctx = smokeContext();
      const code = await main(['--json', '--system'], {
        ...defaultDeps(),
        collect: (options) => collect(options, ctx),
        stdout: (text) => chunks.push(text),
      });
      const parsed: unknown = JSON.parse(chunks.join(''));
      expect(code).toBe(0);
      expect(parsed).toMatchObject({
        entries: expect.any(Array),
        warnings: expect.arrayContaining(['[btm] skipped in tests']),
      });
      expect(JSON.stringify(parsed)).toContain('"source":"system-daemon"');
    }, 60_000);
  },
);
