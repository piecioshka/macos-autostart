import { basename, join } from 'node:path';

import { mapLimit } from '../concurrency.js';
import { errorMessage, ifExists } from '../exec.js';
import type {
  AutostartEntry,
  Context,
  SourceResult,
  Trigger,
} from '../types.js';
import { launchdDir, type LaunchdSource } from './catalog.js';

type Plist = Record<string, unknown>;

const PLUTIL_CONCURRENCY = 16;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY = 86400;
const HOUR = 3600;
const MINUTE = 60;

function isRecord(value: unknown): value is Plist {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberAt(dict: Plist, key: string): number | undefined {
  const value = dict[key];
  return typeof value === 'number' ? value : undefined;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatInterval(seconds: number): string {
  if (seconds > 0 && seconds % DAY === 0) {
    return `every ${seconds / DAY} d`;
  }
  if (seconds > 0 && seconds % HOUR === 0) {
    return `every ${seconds / HOUR} h`;
  }
  if (seconds > 0 && seconds % MINUTE === 0) {
    return `every ${seconds / MINUTE} min`;
  }
  return `every ${seconds} s`;
}

function formatTime(
  hour: number | undefined,
  minute: number | undefined,
): string {
  if (hour !== undefined && minute !== undefined) {
    return `${pad(hour)}:${pad(minute)}`;
  }
  if (hour !== undefined) {
    return `every minute ${pad(hour)}:00-${pad(hour)}:59`;
  }
  if (minute !== undefined) {
    return `every hour at :${pad(minute)}`;
  }
  return 'every minute';
}

/** Describes one StartCalendarInterval dictionary. Missing keys are wildcards, as in launchd. */
export function formatCalendar(dict: Plist): string {
  const hour = numberAt(dict, 'Hour');
  const minute = numberAt(dict, 'Minute');
  const month = numberAt(dict, 'Month');
  const day = numberAt(dict, 'Day');
  const weekday = numberAt(dict, 'Weekday');
  const when: string[] = [];
  if (month !== undefined) when.push(`month ${month}`);
  if (day !== undefined) when.push(`day ${day}`);
  if (weekday !== undefined)
    when.push(WEEKDAYS[weekday] ?? `weekday ${weekday}`);
  if (when.length === 0 && hour !== undefined && minute !== undefined)
    when.push('daily');
  return [...when, formatTime(hour, minute)].join(' ');
}

function keepAliveTriggers(value: unknown): Trigger[] {
  if (value === true) {
    return [{ kind: 'keepalive' }];
  }
  return isRecord(value)
    ? [{ kind: 'keepalive', detail: Object.keys(value).join(', ') }]
    : [];
}

function calendarTriggers(value: unknown): Trigger[] {
  const dicts = (Array.isArray(value) ? value : [value]).filter(isRecord);
  return dicts.length > 0
    ? [{ kind: 'calendar', detail: dicts.map(formatCalendar).join('; ') }]
    : [];
}

function watchTriggers(plist: Plist): Trigger[] {
  const triggers: Trigger[] = [];
  for (const key of ['WatchPaths', 'QueueDirectories']) {
    const paths = plist[key];
    if (Array.isArray(paths) && paths.length > 0) {
      triggers.push({ kind: 'watch', detail: paths.map(String).join(', ') });
    }
  }
  if (plist.StartOnMount === true) {
    triggers.push({ kind: 'watch', detail: 'on volume mount' });
  }
  return triggers;
}

export function parseTriggers(plist: Plist): Trigger[] {
  const load: Trigger[] = plist.RunAtLoad === true ? [{ kind: 'load' }] : [];
  const interval = plist.StartInterval;
  const intervals: Trigger[] =
    typeof interval === 'number'
      ? [{ kind: 'interval', detail: formatInterval(interval) }]
      : [];
  return [
    ...load,
    ...keepAliveTriggers(plist.KeepAlive),
    ...intervals,
    ...calendarTriggers(plist.StartCalendarInterval),
    ...watchTriggers(plist),
  ];
}

function programOf(plist: Plist): string | undefined {
  const args = Array.isArray(plist.ProgramArguments)
    ? plist.ProgramArguments.map(String)
    : [];
  const parts =
    typeof plist.Program === 'string'
      ? [plist.Program, ...args.slice(1)]
      : args;
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function entryFromPlist(
  plist: Plist,
  file: string,
  source: LaunchdSource,
): AutostartEntry | null {
  const triggers = parseTriggers(plist);
  if (triggers.length === 0) {
    return null;
  }
  return {
    source,
    label:
      typeof plist.Label === 'string' ? plist.Label : basename(file, '.plist'),
    program: programOf(plist),
    file,
    triggers,
    state: plist.Disabled === true ? { disabled: true } : {},
  };
}

async function readPlist(ctx: Context, file: string): Promise<Plist> {
  const result = await ctx.exec('plutil', [
    '-convert',
    'json',
    '-o',
    '-',
    file,
  ]);
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `plutil exited with ${result.code}`,
    );
  }
  const parsed: unknown = JSON.parse(result.stdout);
  if (isRecord(parsed)) {
    return parsed;
  }
  throw new Error('not a dictionary');
}

interface FileResult {
  entry: AutostartEntry | null;
  warning?: string;
}

async function readEntry(
  ctx: Context,
  file: string,
  source: LaunchdSource,
): Promise<FileResult> {
  try {
    return { entry: entryFromPlist(await readPlist(ctx, file), file, source) };
  } catch (error) {
    const message = errorMessage(error);
    if (/no such file/i.test(message)) {
      return { entry: null };
    }
    return {
      entry: null,
      warning: `[${source}] ${basename(file)}: ${message}`,
    };
  }
}

async function listPlists(ctx: Context, dir: string): Promise<string[]> {
  const names = await ifExists(ctx.fs.readdir(dir), []);
  return names
    .filter((name) => name.endsWith('.plist'))
    .sort()
    .map((name) => join(dir, name));
}

export async function collectLaunchd(
  ctx: Context,
  source: LaunchdSource,
): Promise<SourceResult> {
  const files = await listPlists(ctx, launchdDir(source, ctx.home));
  const results = await mapLimit(files, PLUTIL_CONCURRENCY, (file) =>
    readEntry(ctx, file, source),
  );
  return {
    entries: results.flatMap((result) => (result.entry ? [result.entry] : [])),
    warnings: results.flatMap((result) =>
      result.warning ? [result.warning] : [],
    ),
  };
}
