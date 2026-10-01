import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isFresh, readCache, writeCache } from '../cache.js';
import type { AutostartEntry, Context, Trigger } from '../types.js';

export interface BtmItem {
  uid: number;
  type: string;
  disposition: string[];
  embedded: boolean;
  name?: string;
  identifier?: string;
  url?: string;
  executablePath?: string;
  parent?: string;
}

export interface BtmEntries {
  entries: AutostartEntry[];
  /** Absolute plist paths of legacy agents and daemons that the user switched off in System Settings. */
  legacyDisabled: Set<string>;
}

export interface BtmResult extends BtmEntries {
  /** Problems that did not stop the scan, e.g. a cache file that could not be saved. */
  warnings: string[];
}

export interface ReadBtmOptions {
  /** Skip the cached output, run `sfltool dumpbtm` and cache the fresh result. */
  noCache?: boolean;
}

const COMMAND = 'sfltool dumpbtm';
/** `sfltool dumpbtm` can wait this long for the user to answer the administrator password dialog. */
export const SFLTOOL_TIMEOUT_MS = 5 * 60_000;
const CACHE_FILE = 'sfltool-dumpbtm.json';

interface Draft {
  uid: number;
  fields: Map<string, string>;
  embedded: boolean;
}

const RECORDS = /Records for UID (-?\d+)/;
const ITEM_START = /^\s*#\d+:\s*$/;
const EMBEDDED = /^\s+Embedded Item Identifiers:\s*$/;
const FIELD = /^\s+([A-Za-z][A-Za-z ]*?):\s(.*)$/;
/** Items registered through SMAppService: login items, agents and daemons inside an app bundle. */
const APP_SERVICE_TYPES = new Set(['login item', 'agent', 'daemon']);
const LEGACY_TYPES = new Set(['legacy agent', 'legacy daemon']);
const SHARED_UIDS = [0, -2];

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' || trimmed === '(null)'
    ? undefined
    : trimmed;
}

function parseDisposition(value: string): string[] {
  const [, inside = ''] = /\[(.*)\]/.exec(value) ?? [];
  return inside
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function toItem(draft: Draft): BtmItem {
  const get = (key: string): string | undefined => clean(draft.fields.get(key));
  return {
    uid: draft.uid,
    name: get('Name'),
    type: (get('Type') ?? '').replace(/\s*\(0x[0-9a-f]+\)$/i, ''),
    disposition: parseDisposition(get('Disposition') ?? ''),
    identifier: get('Identifier'),
    url: get('URL'),
    executablePath: get('Executable Path'),
    parent: get('Parent Identifier'),
    embedded: draft.embedded,
  };
}

/** Applies one output line to the drafts and returns the (possibly updated) UID. */
function applyLine(drafts: Draft[], line: string, uid: number): number {
  const records = RECORDS.exec(line);
  const field = FIELD.exec(line);
  const current = drafts.at(-1);
  if (records) {
    return Number(records[1]);
  }
  if (ITEM_START.test(line)) {
    drafts.push({ uid, fields: new Map(), embedded: false });
  } else if (current && EMBEDDED.test(line)) {
    current.embedded = true;
  } else if (current && field?.[1]) {
    current.fields.set(field[1].trim(), field[2] ?? '');
  }
  return uid;
}

/** Parses the undocumented output of `sfltool dumpbtm` (macOS 13+). */
export function parseBtm(output: string): BtmItem[] {
  const drafts: Draft[] = [];
  let uid = Number.NaN;
  for (const line of output.split('\n')) {
    uid = applyLine(drafts, line, uid);
  }
  return drafts.map(toItem);
}

function isDisabled(item: BtmItem): boolean {
  return (
    item.disposition.includes('disabled') ||
    item.disposition.includes('disallowed')
  );
}

/** A classic "Open at Login" app: enabled and not just a group of embedded items. */
function isLoginApp(item: BtmItem): boolean {
  return (
    item.type === 'app' &&
    !item.embedded &&
    item.disposition.includes('enabled')
  );
}

/** Third-party items can carry malformed URLs (`100%.app`, `file://host/x`): undefined instead of a throw. */
function tryFileUrlToPath(url: string): string | undefined {
  try {
    return fileURLToPath(url).replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function tryDecode(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

function appPaths(items: BtmItem[]): Map<string, string> {
  const paths = new Map<string, string>();
  for (const item of items) {
    const path =
      item.type === 'app' && item.url?.startsWith('file://')
        ? tryFileUrlToPath(item.url)
        : undefined;
    if (item.identifier && path !== undefined) {
      paths.set(item.identifier, path);
    }
  }
  return paths;
}

function resolvePath(
  value: string | undefined,
  base: string | undefined,
): string | undefined {
  if (value === undefined || value.startsWith('/')) {
    return value;
  }
  if (value.startsWith('file://')) {
    return tryFileUrlToPath(value) ?? value;
  }
  const relative = tryDecode(value) ?? value;
  return base === undefined ? relative : join(base, relative);
}

function triggerOf(item: BtmItem): Trigger {
  return item.type === 'daemon'
    ? { kind: 'load', detail: 'at boot' }
    : { kind: 'load' };
}

function toEntry(item: BtmItem, apps: Map<string, string>): AutostartEntry {
  const base = item.parent === undefined ? undefined : apps.get(item.parent);
  const file = resolvePath(item.url, base);
  return {
    source: 'btm',
    label: item.identifier?.replace(/^\d+\./, '') ?? item.name ?? 'unknown',
    program: resolvePath(item.executablePath, base) ?? file,
    file,
    triggers: [triggerOf(item)],
    state: isDisabled(item) ? { disabled: true } : {},
  };
}

function legacyDisabledPaths(items: BtmItem[]): Set<string> {
  const paths = new Set<string>();
  for (const item of items) {
    if (
      LEGACY_TYPES.has(item.type) &&
      isDisabled(item) &&
      item.url?.startsWith('file://')
    ) {
      paths.add(tryFileUrlToPath(item.url) ?? item.url);
    }
  }
  return paths;
}

export function btmEntries(items: BtmItem[], uid: number): BtmEntries {
  const relevant = items.filter(
    (item) => item.uid === uid || SHARED_UIDS.includes(item.uid),
  );
  const apps = appPaths(relevant);
  return {
    entries: relevant
      .filter((item) => APP_SERVICE_TYPES.has(item.type) || isLoginApp(item))
      .map((item) => toEntry(item, apps)),
    legacyDisabled: legacyDisabledPaths(relevant),
  };
}

/** Runs `sfltool dumpbtm` and returns its output, or throws when it failed or printed something unknown. */
async function dumpBtm(ctx: Context): Promise<string> {
  const result = await ctx.exec('sfltool', ['dumpbtm'], {
    timeoutMs: SFLTOOL_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `sfltool exited with ${result.code}`,
    );
  }
  if (RECORDS.test(result.stdout)) {
    return result.stdout;
  }
  throw new Error(`unrecognized output of ${COMMAND}`);
}

async function cachedDump(ctx: Context): Promise<string | undefined> {
  const entry = await readCache(ctx, CACHE_FILE);
  return entry && isFresh(ctx, entry) && RECORDS.test(entry.stdout)
    ? entry.stdout
    : undefined;
}

/**
 * Reads Background Task Management. `sfltool dumpbtm` can ask for an administrator
 * password on every call, so its successful output is cached for `Context.cacheTtlHours`.
 */
export async function readBtm(
  ctx: Context,
  options: ReadBtmOptions = {},
): Promise<BtmResult> {
  const cached = options.noCache ? undefined : await cachedDump(ctx);
  if (cached !== undefined) {
    return { ...btmEntries(parseBtm(cached), ctx.uid), warnings: [] };
  }
  const stdout = await dumpBtm(ctx);
  const warnings = await writeCache(ctx, CACHE_FILE, {
    command: COMMAND,
    savedAt: ctx.now(),
    stdout,
  });
  return { ...btmEntries(parseBtm(stdout), ctx.uid), warnings };
}
