import {
  groupEntries,
  stateClass,
  type EntryGroup,
  type StateClass,
} from '../describe.js';
import { isAppleSource } from '../sources/catalog.js';
import type { AutostartEntry, EntryState } from '../types.js';

export type Tab = EntryGroup;
export type SortKey = 'label' | 'source' | 'state';

export interface Sort {
  key: SortKey;
  descending: boolean;
}

export interface RowQuery {
  tab: Tab;
  showApple: boolean;
  filter: string;
  sort: Sort;
}

export const TABS: readonly Tab[] = ['startup', 'periodic'];
export const TAB_TITLES: Record<Tab, string> = {
  startup: 'At startup',
  periodic: 'Periodic',
};
export const SORT_KEYS: readonly SortKey[] = ['label', 'source', 'state'];

const STATE_RANKS: Record<StateClass, number> = {
  running: 0,
  failed: 1,
  loaded: 2,
  'not-loaded': 3,
  disabled: 4,
  unknown: 5,
};

/** Sort order of states: running, failed, loaded, not loaded, disabled, unknown. */
export function stateRank(state: EntryState): number {
  return STATE_RANKS[stateClass(state)];
}

export function entryKey(entry: AutostartEntry): string {
  return `${entry.source}:${entry.label}:${entry.file ?? ''}`;
}

export function isApple(entry: AutostartEntry): boolean {
  return isAppleSource(entry.source);
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function compareBy(key: SortKey, a: AutostartEntry, b: AutostartEntry): number {
  if (key === 'source') {
    return compareText(a.source, b.source);
  }
  if (key === 'state') {
    return stateRank(a.state) - stateRank(b.state);
  }
  return compareText(a.label.toLowerCase(), b.label.toLowerCase());
}

function matches(entry: AutostartEntry, needle: string): boolean {
  return (
    needle === '' ||
    [entry.label, entry.program ?? '', entry.file ?? ''].some((text) =>
      text.toLowerCase().includes(needle),
    )
  );
}

/** The entries one tab shows, after the Apple toggle, the filter and the sort. */
export function visibleRows(
  entries: AutostartEntry[],
  query: RowQuery,
): AutostartEntry[] {
  const groups = groupEntries(entries);
  const inTab = query.tab === 'startup' ? groups.atStartup : groups.periodic;
  const needle = query.filter.toLowerCase();
  const direction = query.sort.descending ? -1 : 1;
  return inTab
    .filter((entry) => query.showApple || !isApple(entry))
    .filter((entry) => matches(entry, needle))
    .sort(
      (a, b) =>
        direction * compareBy(query.sort.key, a, b) ||
        compareText(a.label, b.label) ||
        // entryKey is unique per entry, so the order never depends on the input order.
        compareText(entryKey(a), entryKey(b)),
    );
}
