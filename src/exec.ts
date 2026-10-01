import { execFile, type ExecFileException } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { constants, homedir } from 'node:os';

import { cacheDirectory, parseTtlHours, type Env } from './cache-settings.js';
import type { Context, Exec, FsLike } from './types.js';

const MAX_BUFFER = 64 * 1024 * 1024;
/** Exit codes as shells report them. */
const COMMAND_NOT_FOUND = 127;
const TIMED_OUT = 124;
const SIGNAL_BASE = 128;

/** How long one system command may run before it is killed, unless the call sets its own `timeoutMs`. */
export const EXEC_TIMEOUT_MS = 30_000;
const MS_PER_SECOND = 1000;

/** Exit code of a failed child: its own code, 124 for a timeout, 128 + N for signal N, else 127. */
export function exitCode(error: ExecFileException): number {
  if (typeof error.code === 'number') {
    return error.code;
  }
  if (error.killed) {
    return TIMED_OUT;
  }
  const signal = error.signal ? constants.signals[error.signal] : undefined;
  return signal === undefined ? COMMAND_NOT_FOUND : SIGNAL_BASE + signal;
}

/** A child that exits or never reads stdin breaks the pipe. */
function ignoreStdinError(): void {
  // the exit code and stderr already report the failure
}

/** Runs a binary without a shell. Never rejects: failures come back as a non-zero `code`. */
export function createExec(defaultTimeout: number): Exec {
  return (file, args, options = {}) =>
    new Promise((resolve) => {
      const timeout = options.timeoutMs ?? defaultTimeout;
      const child = execFile(
        file,
        [...args],
        { maxBuffer: MAX_BUFFER, encoding: 'utf8', timeout },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ stdout, stderr, code: 0 });
            return;
          }
          const message = error.killed
            ? `${file} timed out after ${timeout / MS_PER_SECOND} s`
            : error.message;
          resolve({ stdout, stderr: stderr || message, code: exitCode(error) });
        },
      );
      if (options.input !== undefined) {
        child.stdin?.on('error', ignoreStdinError);
        child.stdin?.end(options.input);
      }
    });
}

export const defaultExec: Exec = createExec(EXEC_TIMEOUT_MS);

export const defaultFs: FsLike = {
  readdir: (path) => readdir(path),
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  writeFile: (path, content, mode) =>
    writeFile(path, content, { encoding: 'utf8', mode }),
};

export function defaultContext(env: Env = process.env): Context {
  const home = homedir();
  return {
    exec: defaultExec,
    fs: defaultFs,
    home,
    uid: process.getuid?.() ?? 0,
    cacheDir: cacheDirectory(env, home),
    cacheTtlHours: parseTtlHours(env.CACHE_TTL_HOURS),
    now: () => Date.now(),
  };
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Resolves to `fallback` when the promise fails because a path does not exist. */
export async function ifExists<T>(
  promise: Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isMissing(error)) {
      return fallback;
    }
    throw error;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
