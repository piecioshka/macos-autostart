import type {
  AutostartEntry,
  EntryState,
  Source,
  Trigger,
  TriggerKind,
} from './types.js';
import { sanitize, shortenHome } from './render/text.js';
import { startsAtBoot } from './sources/catalog.js';

export type EntryGroup = 'startup' | 'periodic';
export type StateClass =
  'disabled' | 'running' | 'failed' | 'loaded' | 'not-loaded' | 'unknown';

export interface Groups {
  atStartup: AutostartEntry[];
  periodic: AutostartEntry[];
}

export interface EntryText {
  label: string;
  source: string;
  when: string;
  state: string;
  program: string;
  file: string;
}

const STARTUP_KINDS: ReadonlySet<TriggerKind> = new Set(['load', 'keepalive']);

export const isStartup = (trigger: Trigger): boolean =>
  STARTUP_KINDS.has(trigger.kind);
export const isPeriodic = (trigger: Trigger): boolean =>
  !STARTUP_KINDS.has(trigger.kind);

export function groupEntries(entries: AutostartEntry[]): Groups {
  return {
    atStartup: entries.filter((entry) => entry.triggers.some(isStartup)),
    periodic: entries.filter((entry) => entry.triggers.some(isPeriodic)),
  };
}

export function formatTrigger(trigger: Trigger, source: Source): string {
  const { kind, detail } = trigger;
  if (kind === 'load') {
    return detail ?? (startsAtBoot(source) ? 'at boot' : 'at login');
  }
  if (kind === 'keepalive') {
    return detail ? `keep alive (${detail})` : 'keep alive';
  }
  if (kind === 'watch') {
    return `watch ${detail ?? ''}`.trim();
  }
  return detail ?? kind;
}

/** launchd reports a job killed by a signal as the negative signal number. */
function formatExit(code: number): string {
  return code < 0 ? `killed (signal ${-code})` : `exited ${code}`;
}

export function stateClass(state: EntryState): StateClass {
  if (state.disabled) {
    return 'disabled';
  }
  if (state.pid !== undefined) {
    return 'running';
  }
  if (state.lastExitCode !== undefined && state.lastExitCode !== 0) {
    return 'failed';
  }
  if (state.loaded === true) {
    return 'loaded';
  }
  return state.loaded === false ? 'not-loaded' : 'unknown';
}

export function formatState(state: EntryState): string {
  const texts: Record<StateClass, () => string> = {
    disabled: () => 'disabled',
    running: () => `running (PID ${state.pid})`,
    failed: () => formatExit(state.lastExitCode ?? 0),
    loaded: () => 'loaded',
    'not-loaded': () => 'not loaded',
    unknown: () => '-',
  };
  return texts[stateClass(state)]();
}

/** The entry's triggers, only those of `group` when one is given. */
export function whenText(entry: AutostartEntry, group?: EntryGroup): string {
  const inGroup = group === 'periodic' ? isPeriodic : isStartup;
  return entry.triggers
    .filter((trigger) => group === undefined || inGroup(trigger))
    .map((trigger) => formatTrigger(trigger, entry.source))
    .join(', ');
}

/** Every text of an entry as shown on screen: control characters replaced, home shortened. */
export function describeEntry(
  entry: AutostartEntry,
  options: { home: string; group?: EntryGroup },
): EntryText {
  const { home, group } = options;
  const path = (text: string): string => sanitize(shortenHome(text, home));
  return {
    label: sanitize(entry.label),
    source: sanitize(entry.source),
    when: path(whenText(entry, group)),
    state: sanitize(formatState(entry.state)),
    program: path(entry.program ?? entry.file ?? ''),
    file: path(entry.file ?? ''),
  };
}
