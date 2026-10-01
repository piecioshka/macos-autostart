import { defaultContext, errorMessage } from './exec.js';
import { readBtm, type BtmEntries } from './sources/btm.js';
import { collectCron, collectPeriodic } from './sources/cron.js';
import {
  isAppleSource,
  isLaunchdSource,
  type LaunchdSource,
} from './sources/catalog.js';
import { collectLaunchd } from './sources/launchd.js';
import { readLaunchdState, resolveState, type LaunchdState } from './state.js';
import {
  SOURCES,
  type AutostartEntry,
  type CollectOptions,
  type CollectResult,
  type Context,
  type Source,
  type SourceResult,
} from './types.js';

export { SOURCES } from './types.js';
export type {
  AutostartEntry,
  CollectOptions,
  CollectResult,
  EntryState,
  Source,
  Trigger,
  TriggerKind,
} from './types.js';

export function selectSources(options: CollectOptions): Source[] {
  const { sources } = options;
  if (sources) {
    return SOURCES.filter((source) => sources.includes(source));
  }
  return SOURCES.filter(
    (source) => options.includeSystem === true || !isAppleSource(source),
  );
}

async function guard(
  name: string,
  warnings: string[],
  task: () => Promise<SourceResult>,
): Promise<AutostartEntry[]> {
  try {
    const result = await task();
    warnings.push(...result.warnings);
    return result.entries;
  } catch (error) {
    warnings.push(`[${name}] ${errorMessage(error)}`);
    return [];
  }
}

async function launchdEntries(
  ctx: Context,
  sources: LaunchdSource[],
  warnings: string[],
): Promise<{ entries: AutostartEntry[]; launchd: LaunchdState }> {
  const entries: AutostartEntry[] = [];
  // One directory at a time: each already runs up to 16 plutil, so the limit stays global.
  for (const source of sources) {
    entries.push(
      ...(await guard(source, warnings, () => collectLaunchd(ctx, source))),
    );
  }
  if (entries.length === 0) {
    return { entries, launchd: {} };
  }
  const { state, warnings: stateWarnings } = await readLaunchdState(ctx);
  warnings.push(...stateWarnings);
  return { entries, launchd: state };
}

const NO_BTM: BtmEntries = { entries: [], legacyDisabled: new Set() };

/**
 * Reads BTM. Its own problems go to `btmWarnings` (only shown when BTM entries were requested),
 * cache problems always go to `warnings`: they explain why sfltool keeps asking for a password.
 */
async function btm(
  ctx: Context,
  noCache: boolean,
  btmWarnings: string[],
  warnings: string[],
): Promise<BtmEntries> {
  try {
    const result = await readBtm(ctx, { noCache });
    warnings.push(...result.warnings);
    return result;
  } catch (error) {
    btmWarnings.push(`[btm] ${errorMessage(error)}`);
    return NO_BTM;
  }
}

function sortEntries(entries: AutostartEntry[]): AutostartEntry[] {
  return [...entries].sort(
    (a, b) =>
      SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source) ||
      a.label.localeCompare(b.label),
  );
}

function optional(
  enabled: boolean,
  name: string,
  warnings: string[],
  task: () => Promise<SourceResult>,
): Promise<AutostartEntry[]> {
  return enabled ? guard(name, warnings, task) : Promise.resolve([]);
}

/** Lists everything that starts automatically. Never rejects: a broken source becomes a warning. */
export async function collect(
  options: CollectOptions = {},
  ctx: Context = defaultContext(),
): Promise<CollectResult> {
  const selected = selectSources(options);
  const warnings: string[] = [];
  const launchdSources = selected.filter(isLaunchdSource);
  const wantsBtm = selected.includes('btm');
  const needsBtm = wantsBtm || launchdSources.length > 0;
  const [launchd, btmResult, cron, periodic] = await Promise.all([
    launchdEntries(ctx, launchdSources, warnings),
    needsBtm
      ? btm(ctx, options.noCache === true, wantsBtm ? warnings : [], warnings)
      : Promise.resolve(NO_BTM),
    optional(selected.includes('cron'), 'cron', warnings, () =>
      collectCron(ctx),
    ),
    optional(selected.includes('periodic'), 'periodic', warnings, () =>
      collectPeriodic(ctx),
    ),
  ]);
  const entries = [
    ...resolveState(launchd.entries, {
      launchd: launchd.launchd,
      btmDisabled: btmResult.legacyDisabled,
    }),
    ...(wantsBtm ? btmResult.entries : []),
    ...cron,
    ...periodic,
  ];
  return { entries: sortEntries(entries), warnings };
}
