import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Context, ExecResult } from '../types.js';

export interface FakeSystem {
  /** Key: binary and arguments joined with single spaces, e.g. `launchctl list`. */
  commands?: Record<string, ExecResult>;
  /** File path -> content. Files written through `fs.writeFile` land here too. */
  files?: Record<string, string>;
  /** File path -> mode of every file written through `fs.writeFile`. */
  modes?: Record<string, number>;
  /** Directory path -> entry names. Directories made with `fs.mkdir` land here too. */
  dirs?: Record<string, string[]>;
  /** When set, `fs.mkdir` and `fs.writeFile` reject with this message. */
  writeError?: string;
  home?: string;
  uid?: number;
  cacheDir?: string;
  cacheTtlHours?: number;
  /** Fixed current time in milliseconds. */
  now?: number;
  /** Every executed command is pushed here. */
  calls?: string[];
  /** Stdin input of each executed command, keyed like `calls`. */
  inputs?: Record<string, string>;
}

/** The fixed "now" of a fake context: 2026-09-29 12:00 UTC. */
export const FAKE_NOW = Date.UTC(2026, 8, 29, 12);

function enoent(path: string): Error {
  return Object.assign(
    new Error(`ENOENT: no such file or directory, '${path}'`),
    { code: 'ENOENT' },
  );
}

function fakeMkdir(system: FakeSystem, path: string): Promise<void> {
  if (system.writeError !== undefined) {
    return Promise.reject(new Error(system.writeError));
  }
  system.dirs = { [path]: [], ...system.dirs };
  return Promise.resolve();
}

function fakeWriteFile(
  system: FakeSystem,
  path: string,
  content: string,
  mode: number,
): Promise<void> {
  if (system.writeError !== undefined) {
    return Promise.reject(new Error(system.writeError));
  }
  if (!system.dirs?.[dirname(path)]) {
    return Promise.reject(enoent(dirname(path)));
  }
  system.files = { ...system.files, [path]: content };
  system.modes = { ...system.modes, [path]: mode };
  return Promise.resolve();
}

export function fakeContext(system: FakeSystem = {}): Context {
  const home = system.home ?? '/Users/example';
  return {
    home,
    uid: system.uid ?? 501,
    cacheDir: system.cacheDir ?? `${home}/.cache/macos-autostart`,
    cacheTtlHours: system.cacheTtlHours ?? 24,
    now: () => system.now ?? FAKE_NOW,
    exec: (file, args, options) => {
      const key = [file, ...args].join(' ');
      system.calls?.push(key);
      if (options?.input !== undefined) {
        system.inputs = { ...system.inputs, [key]: options.input };
      }
      return Promise.resolve(
        system.commands?.[key] ?? fail(`unexpected command: ${key}`, 127),
      );
    },
    fs: {
      readdir: (path) => {
        const names = system.dirs?.[path];
        return names ? Promise.resolve(names) : Promise.reject(enoent(path));
      },
      readFile: (path) => {
        const content = system.files?.[path];
        return content === undefined
          ? Promise.reject(enoent(path))
          : Promise.resolve(content);
      },
      mkdir: (path) => fakeMkdir(system, path),
      writeFile: (path, content, mode) =>
        fakeWriteFile(system, path, content, mode),
    },
  };
}

export function ok(stdout: string): ExecResult {
  return { stdout, stderr: '', code: 0 };
}

export function fail(stderr: string, code = 1): ExecResult {
  return { stdout: '', stderr, code };
}

/** Reads a file from `src/__fixtures__/`. */
export function fixture(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
}
