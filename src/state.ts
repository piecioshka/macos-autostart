import { domainOf, isLaunchdSource } from './sources/catalog.js';
import type { AutostartEntry, Context, EntryState } from './types.js';

export type StateMap = Map<string, EntryState>;
export type DisabledMap = Map<string, boolean>;

export interface LaunchdState {
  gui?: StateMap;
  system?: StateMap;
  guiDisabled?: DisabledMap;
  systemDisabled?: DisabledMap;
}

const SERVICE_LINE = /^\s+(\d+)\s+(\S+)\s+(.+?)\s*$/;
const DISABLED_LINE = /^\s+"(.+)" => (\w+)\s*$/gm;

function toState(pid: string, status: string): EntryState {
  const state: EntryState = { loaded: true };
  if (/^\d+$/.test(pid) && Number(pid) > 0) {
    state.pid = Number(pid);
  }
  if (/^-?\d+$/.test(status)) {
    state.lastExitCode = Number(status);
  }
  return state;
}

/** Parses `launchctl list`: tab-separated PID, Status and Label with a header row. */
export function parseLaunchctlList(output: string): StateMap {
  const map: StateMap = new Map();
  for (const line of output.split('\n').slice(1)) {
    const [pid, status, label] = line.split('\t');
    if (pid && status && label) {
      map.set(label, toState(pid, status));
    }
  }
  return map;
}

function servicesBlock(output: string): string[] {
  const lines = output.split('\n');
  const start = lines.findIndex((line) => line.startsWith('\tservices = {'));
  if (start === -1) {
    return [];
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('\t}'));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Parses the `services` block of `launchctl print <domain>`. */
export function parseLaunchctlPrint(output: string): StateMap {
  const map: StateMap = new Map();
  for (const line of servicesBlock(output)) {
    const [, pid, status, label] = SERVICE_LINE.exec(line) ?? [];
    if (pid && status && label) {
      map.set(label, toState(pid, status));
    }
  }
  return map;
}

/** Parses `launchctl print-disabled <domain>`. Value `true` means disabled. */
export function parsePrintDisabled(output: string): DisabledMap {
  const map: DisabledMap = new Map();
  for (const [, label, value] of output.matchAll(DISABLED_LINE)) {
    if (label && value) {
      map.set(label, value === 'disabled' || value === 'true');
    }
  }
  return map;
}

async function run<T>(
  ctx: Context,
  args: string[],
  parse: (output: string) => T,
  warnings: string[],
): Promise<T | undefined> {
  const result = await ctx.exec('launchctl', args);
  if (result.code === 0) {
    return parse(result.stdout);
  }
  warnings.push(
    `[launchctl] ${args.join(' ')}: ${result.stderr.trim() || `exit ${result.code}`}`,
  );
  return undefined;
}

export async function readLaunchdState(
  ctx: Context,
): Promise<{ state: LaunchdState; warnings: string[] }> {
  const warnings: string[] = [];
  const [gui, system, guiDisabled, systemDisabled] = await Promise.all([
    run(ctx, ['list'], parseLaunchctlList, warnings),
    run(ctx, ['print', 'system'], parseLaunchctlPrint, warnings),
    run(
      ctx,
      ['print-disabled', `gui/${ctx.uid}`],
      parsePrintDisabled,
      warnings,
    ),
    run(ctx, ['print-disabled', 'system'], parsePrintDisabled, warnings),
  ]);
  return { state: { gui, system, guiDisabled, systemDisabled }, warnings };
}

/**
 * Reads only what changes while services run (loaded, PID, last exit code):
 * `launchctl list` and `launchctl print system`, without the print-disabled pair.
 */
async function readRuntimeState(ctx: Context): Promise<{
  state: Pick<LaunchdState, 'gui' | 'system'>;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const [gui, system] = await Promise.all([
    run(ctx, ['list'], parseLaunchctlList, warnings),
    run(ctx, ['print', 'system'], parseLaunchctlPrint, warnings),
  ]);
  return { state: { gui, system }, warnings };
}

/** Adds live state to a launchd entry. Daemons live in the system domain, agents in the user's gui domain. */
function applyState(
  entry: AutostartEntry,
  state: LaunchdState,
): AutostartEntry {
  if (!isLaunchdSource(entry.source)) {
    return entry;
  }
  const daemon = domainOf(entry.source) === 'system';
  const running = daemon ? state.system : state.gui;
  const disabledMap = daemon ? state.systemDisabled : state.guiDisabled;
  const next: EntryState = { ...entry.state };
  if (running) {
    Object.assign(next, running.get(entry.label) ?? { loaded: false });
  }
  const disabled = disabledMap?.get(entry.label);
  if (disabled !== undefined) {
    next.disabled = disabled;
  }
  return { ...entry, state: next };
}

export interface StateSignals {
  launchd: LaunchdState;
  /** Absolute plist paths of legacy jobs the user switched off in System Settings (BTM). */
  btmDisabled: ReadonlySet<string>;
}

/**
 * Decides the state of every launchd entry; other entries come back unchanged.
 * Loaded, PID and last exit code come from the entry's domain; a label missing from a domain
 * that was read is not loaded, a domain that could not be read changes nothing.
 * Disabled: BTM disallowed wins, then `print-disabled`, then the plist `Disabled` key.
 */
export function resolveState(
  entries: AutostartEntry[],
  signals: StateSignals,
): AutostartEntry[] {
  return entries.map((entry) => {
    if (!isLaunchdSource(entry.source)) {
      return entry;
    }
    const resolved = applyState(entry, signals.launchd);
    return entry.file !== undefined && signals.btmDisabled.has(entry.file)
      ? { ...resolved, state: { ...resolved.state, disabled: true } }
      : resolved;
  });
}

function withRuntime(
  entry: AutostartEntry,
  launchd: Pick<LaunchdState, 'gui' | 'system'>,
): AutostartEntry {
  if (!isLaunchdSource(entry.source)) {
    return entry;
  }
  const domain =
    domainOf(entry.source) === 'system' ? launchd.system : launchd.gui;
  if (domain === undefined) {
    return entry;
  }
  const fresh = applyState({ ...entry, state: {} }, launchd);
  return {
    ...entry,
    state: {
      loaded: fresh.state.loaded,
      pid: fresh.state.pid,
      lastExitCode: fresh.state.lastExitCode,
      disabled: entry.state.disabled,
    },
  };
}

/**
 * Updates only what changes while services run (loaded, PID, last exit code) from
 * `launchctl list` and `launchctl print system`. `disabled` is kept: it also carries
 * the BTM flag, which launchctl does not know.
 */
export async function refreshRuntime(
  ctx: Context,
  entries: AutostartEntry[],
): Promise<{ entries: AutostartEntry[]; warnings: string[] }> {
  const { state, warnings } = await readRuntimeState(ctx);
  return {
    entries: entries.map((entry) => withRuntime(entry, state)),
    warnings,
  };
}
