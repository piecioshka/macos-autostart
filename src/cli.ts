import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';

import { isNoCacheEnv, type Env } from './cache-settings.js';
import { errorMessage } from './exec.js';
import { collect } from './index.js';
import { renderJson } from './render/json.js';
import { renderTable } from './render/table.js';
import { LAUNCHD_SOURCES } from './sources/catalog.js';
import { createTuiDeps, runTui, type TuiLaunch } from './tui/app.js';
import {
  SOURCES,
  type CollectOptions,
  type CollectResult,
  type Source,
} from './types.js';

interface PackageJson {
  name: string;
  version: string;
  author: { name: string; email: string; url: string };
}

export interface CliDeps {
  collect: (options: CollectOptions) => Promise<CollectResult>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  platform: string;
  width: number;
  home: string;
  /** Environment variables, read for NO_CACHE. */
  env: Env;
  /** True when both stdin and stdout are terminals. */
  isTty: boolean;
  runTui: (launch: TuiLaunch) => Promise<number>;
  /**
   * Ends the process. Called only after the TUI, so a still pending child
   * (such as the sfltool password dialog) cannot keep the process alive.
   */
  exit: (code: number) => void;
}

export type OutputMode = 'tui' | 'table' | 'json';

interface Flags {
  system: boolean;
  json: boolean;
  table: boolean;
  interactive: boolean;
  help: boolean;
  version: boolean;
  'no-cache': boolean;
  source?: string;
}

const require = createRequire(import.meta.url);
const pkg: PackageJson = require('../package.json');

const DEFAULT_WIDTH = 120;

const USAGE = `Usage: ${pkg.name} [options]

List everything that starts automatically on macOS.

Options:
  -i, --interactive  open the interactive view (default in a terminal)
  --table            print the table even in a terminal
  --json             print JSON instead of a table
  --system           include Apple's own agents and daemons from /System
  --source <name>    show only one source: ${[...SOURCES, 'launchd'].join(', ')}
  --no-cache         run sfltool dumpbtm again instead of using its cached output
  -h, --help         show this help
  -v, --version      show the version
`;

export function defaultDeps(): CliDeps {
  return {
    collect: (options) => collect(options),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    platform: process.platform,
    width: process.stdout.columns || DEFAULT_WIDTH,
    home: homedir(),
    env: process.env,
    isTty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    runTui: (launch) => runTui(createTuiDeps(launch, pkg.version)),
    exit: (code) => process.exit(code),
  };
}

export function parseSources(value: string | undefined): Source[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'launchd') {
    return [...LAUNCHD_SOURCES];
  }
  const source = SOURCES.find((candidate) => candidate === value);
  if (source) {
    return [source];
  }
  throw new Error(`unknown source: ${value}`);
}

function parseFlags(argv: string[]): Flags {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      system: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      table: { type: 'boolean', default: false },
      interactive: { type: 'boolean', short: 'i', default: false },
      source: { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  return values;
}

function header(): string {
  const author = `${pkg.author.name} <${pkg.author.email}> ${pkg.author.url}`;
  return `${pkg.name} v${pkg.version}\nCopyright (c) ${new Date().getFullYear()} ${author}\n`;
}

export function chooseMode(
  flags: Pick<Flags, 'json' | 'table' | 'interactive'>,
  isTty: boolean,
): OutputMode {
  const chosen = [flags.json, flags.table, flags.interactive].filter(Boolean);
  if (chosen.length > 1) {
    throw new Error('choose only one of --json, --table and --interactive');
  }
  if (flags.interactive && !isTty) {
    throw new Error('--interactive needs a terminal on stdin and stdout');
  }
  if (flags.json) {
    return 'json';
  }
  if (flags.table) {
    return 'table';
  }
  return flags.interactive || isTty ? 'tui' : 'table';
}

async function runReport(
  flags: Flags,
  sources: Source[] | undefined,
  mode: OutputMode,
  deps: CliDeps,
): Promise<number> {
  const result = await deps.collect({
    includeSystem: flags.system,
    sources,
    noCache: flags['no-cache'] || isNoCacheEnv(deps.env),
  });
  if (mode === 'json') {
    deps.stdout(renderJson(result));
    return 0;
  }
  deps.stdout(
    `${header()}\n${renderTable(result.entries, { width: deps.width, home: deps.home })}`,
  );
  result.warnings.forEach((warning) => deps.stderr(`warning: ${warning}\n`));
  return 0;
}

async function report(
  flags: Flags,
  sources: Source[] | undefined,
  mode: OutputMode,
  deps: CliDeps,
): Promise<number> {
  if (deps.platform !== 'darwin') {
    deps.stderr(
      `${pkg.name} works only on macOS (current platform: ${deps.platform})\n`,
    );
    return 1;
  }
  if (mode === 'tui') {
    const code = await deps.runTui({
      collectOptions: {
        sources,
        noCache: flags['no-cache'] || isNoCacheEnv(deps.env),
      },
      showApple: flags.system,
    });
    // The screen is restored and stderr writes to a TTY are synchronous, so nothing is lost.
    deps.exit(code);
    return code;
  }
  return runReport(flags, sources, mode, deps);
}

/** Handles --help and --version; returns an exit code, or undefined to go on. */
function printInfo(flags: Flags, deps: CliDeps): number | undefined {
  if (flags.help) {
    deps.stdout(USAGE);
    return 0;
  }
  if (flags.version) {
    deps.stdout(`${pkg.version}\n`);
    return 0;
  }
  return undefined;
}

function usageError(error: unknown, deps: CliDeps): number {
  deps.stderr(`${errorMessage(error)}\n\n${USAGE}`);
  return 2;
}

/** Validates what --help and --version do not need: the source and the output mode. */
function resolveRun(
  flags: Flags,
  isTty: boolean,
): { sources: Source[] | undefined; mode: OutputMode } {
  return {
    sources: parseSources(flags.source),
    mode: chooseMode(flags, isTty),
  };
}

export async function main(
  argv: string[] = process.argv.slice(2),
  deps: CliDeps = defaultDeps(),
): Promise<number> {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    return usageError(error, deps);
  }
  const early = printInfo(flags, deps);
  if (early !== undefined) {
    return early;
  }
  let run: ReturnType<typeof resolveRun>;
  try {
    run = resolveRun(flags, deps.isTty);
  } catch (error) {
    return usageError(error, deps);
  }
  return report(flags, run.sources, run.mode, deps);
}
