import { describe, expect, it } from 'vitest';

import type { AutostartEntry } from '../types.js';
import {
  entryKey,
  SORT_KEYS,
  stateRank,
  visibleRows,
  type RowQuery,
} from './rows.js';

function entry(
  label: string,
  overrides: Partial<AutostartEntry> = {},
): AutostartEntry {
  return {
    source: 'user-agent',
    label,
    triggers: [{ kind: 'load' }],
    state: {},
    ...overrides,
  };
}

const ENTRIES = [
  entry('com.example.beta', { state: { loaded: true, pid: 7 } }),
  entry('com.example.alpha', {
    source: 'global-daemon',
    state: { disabled: true },
  }),
  entry('com.apple.thing', {
    source: 'system-agent',
    state: { loaded: true },
  }),
  entry('com.example.timer', {
    triggers: [{ kind: 'interval', detail: 'every 1 h' }],
    program: '/opt/Example/timer',
  }),
  entry('com.example.both', {
    triggers: [{ kind: 'load' }, { kind: 'calendar', detail: 'daily 08:00' }],
    state: { loaded: false },
  }),
];

const QUERY: RowQuery = {
  tab: 'startup',
  showApple: false,
  filter: '',
  sort: { key: 'label', descending: false },
};
const labels = (rows: AutostartEntry[]) => rows.map((row) => row.label);

describe('visibleRows', () => {
  it('shows the tab entries without Apple ones, sorted by label', () => {
    expect(labels(visibleRows(ENTRIES, QUERY))).toEqual([
      'com.example.alpha',
      'com.example.beta',
      'com.example.both',
    ]);
  });

  it('shows Apple entries when asked', () => {
    expect(
      labels(visibleRows(ENTRIES, { ...QUERY, showApple: true })),
    ).toContain('com.apple.thing');
  });

  it('puts an entry with triggers of both kinds into both tabs', () => {
    expect(labels(visibleRows(ENTRIES, { ...QUERY, tab: 'periodic' }))).toEqual(
      ['com.example.both', 'com.example.timer'],
    );
  });

  it('filters by label, program or file, ignoring case', () => {
    expect(
      labels(
        visibleRows(ENTRIES, {
          ...QUERY,
          tab: 'periodic',
          filter: 'EXAMPLE/TIM',
        }),
      ),
    ).toEqual(['com.example.timer']);
    expect(
      visibleRows(ENTRIES, { ...QUERY, filter: 'nothing-matches' }),
    ).toEqual([]);
  });

  it('sorts by source and by state, and reverses', () => {
    const sorted = (key: 'label' | 'source' | 'state', descending: boolean) =>
      labels(visibleRows(ENTRIES, { ...QUERY, sort: { key, descending } }));
    expect(sorted('source', false)).toEqual([
      'com.example.alpha',
      'com.example.beta',
      'com.example.both',
    ]);
    expect(sorted('state', false)).toEqual([
      'com.example.beta',
      'com.example.both',
      'com.example.alpha',
    ]);
    expect(sorted('label', true)).toEqual([
      'com.example.both',
      'com.example.beta',
      'com.example.alpha',
    ]);
  });
});

describe('visibleRows tiebreak', () => {
  const first = entry('com.example.same', {
    file: '/Library/LaunchAgents/a.plist',
  });
  const second = entry('com.example.same', {
    file: '/Library/LaunchAgents/b.plist',
  });

  it.each([...SORT_KEYS])(
    'orders equal %s values the same way whatever the input order',
    (key) => {
      const query = { ...QUERY, sort: { key, descending: false } };
      const files = (rows: AutostartEntry[]) => rows.map((row) => row.file);
      const expected = [first.file, second.file];
      expect(files(visibleRows([first, second], query))).toEqual(expected);
      expect(files(visibleRows([second, first], query))).toEqual(expected);
    },
  );
});

describe('stateRank', () => {
  it('orders running, failed, loaded, not loaded, disabled, unknown', () => {
    expect([
      stateRank({ pid: 1, loaded: true }),
      stateRank({ loaded: true, lastExitCode: 78 }),
      stateRank({ loaded: true }),
      stateRank({ loaded: false }),
      stateRank({ disabled: true, pid: 1 }),
      stateRank({}),
    ]).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('entryKey', () => {
  it('combines source, label and file', () => {
    expect(entryKey(entry('x', { file: '/a.plist' }))).toBe(
      'user-agent:x:/a.plist',
    );
  });
});
