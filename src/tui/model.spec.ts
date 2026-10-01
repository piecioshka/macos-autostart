import { describe, expect, it } from 'vitest';

import type { AutostartEntry } from '../types.js';
import type { Key } from './input.js';
import {
  initialState,
  REFRESHING,
  rowsOf,
  selectedEntry,
  update,
  type TuiEvent,
  type TuiState,
} from './model.js';

function entry(
  label: string,
  overrides: Partial<AutostartEntry> = {},
): AutostartEntry {
  return {
    source: 'user-agent',
    label,
    triggers: [{ kind: 'load' }],
    state: { loaded: true },
    ...overrides,
  };
}

const ENTRIES: AutostartEntry[] = [
  ...Array.from({ length: 30 }, (_, index) =>
    entry(`com.example.a${String(index).padStart(2, '0')}`),
  ),
  entry('com.example.timer', {
    triggers: [{ kind: 'interval', detail: 'every 1 h' }],
    file: '/Library/LaunchAgents/t.plist',
  }),
  entry('com.apple.hidden', { source: 'system-agent' }),
];

function loaded(overrides: Partial<TuiState> = {}): TuiState {
  const state = initialState({
    uid: 501,
    cols: 120,
    rows: 20,
    showApple: false,
  });
  return {
    ...update(state, {
      type: 'loaded',
      result: { entries: ENTRIES, warnings: ['[cron] boom'] },
    }).state,
    ...overrides,
  };
}

const press = (key: Key): TuiEvent => ({ type: 'key', key });
const char = (value: string): TuiEvent => press({ name: 'char', char: value });
function run(state: TuiState, ...events: TuiEvent[]): TuiState {
  return events.reduce((current, event) => update(current, event).state, state);
}

describe('update: loading and tabs', () => {
  it('starts loading and becomes ready with entries', () => {
    const state = loaded();
    expect(state.loading).toBe(false);
    expect(rowsOf(state)).toHaveLength(30);
    expect(rowsOf({ ...state, tab: 'periodic' })).toHaveLength(1);
  });

  it('switches tabs with arrows, tab keys and digits, resetting the selection', () => {
    const state = run(loaded({ selected: 5 }), press({ name: 'right' }));
    expect(state).toMatchObject({ tab: 'periodic', selected: 0, scroll: 0 });
    expect(run(state, press({ name: 'right' })).tab).toBe('startup');
    expect(run(loaded(), char('2')).tab).toBe('periodic');
    expect(run(loaded(), press({ name: 'backtab' })).tab).toBe('periodic');
  });
});

describe('update: movement', () => {
  it('moves and scrolls so the selection stays visible', () => {
    const state = run(loaded(), press({ name: 'end' }));
    expect(state.selected).toBe(29);
    expect(state.scroll).toBe(29 - 11 + 1);
    expect(run(state, char('g'))).toMatchObject({ selected: 0, scroll: 0 });
    expect(run(loaded(), char('j'), char('j'), char('k')).selected).toBe(1);
    expect(run(loaded(), press({ name: 'pagedown' })).selected).toBe(11);
    expect(run(loaded(), press({ name: 'up' })).selected).toBe(0);
  });

  it('keeps the selection visible after a resize', () => {
    const state = run(loaded(), press({ name: 'end' }), {
      type: 'resize',
      cols: 80,
      rows: 12,
    });
    expect(state.selected).toBe(29);
    expect(state.scroll).toBe(29 - 3 + 1);
  });
});

describe('update: filter, sort, Apple toggle', () => {
  it('filters as you type and clears with Escape', () => {
    const filtering = run(loaded(), char('/'), char('a'), char('0'), char('7'));
    expect(filtering.mode).toBe('filter');
    expect(rowsOf(filtering).map((row) => row.label)).toEqual([
      'com.example.a07',
    ]);
    expect(run(filtering, press({ name: 'backspace' })).filter).toBe('a0');
    expect(run(filtering, press({ name: 'enter' }))).toMatchObject({
      mode: 'list',
      filter: 'a07',
    });
    expect(run(filtering, press({ name: 'escape' }))).toMatchObject({
      mode: 'list',
      filter: '',
    });
  });

  it('says Nothing selected when the filter matches nothing', () => {
    const state = run(
      loaded(),
      char('/'),
      char('z'),
      char('z'),
      press({ name: 'enter' }),
      char('e'),
    );
    expect(state.status).toBe('Nothing selected');
    expect(update(state, char('e')).effects).toEqual([]);
  });

  it('cycles the sort key and keeps the selected entry', () => {
    const state = run(loaded(), char('j'), char('j'), char('S'));
    expect(state.sort).toEqual({ key: 'source', descending: false });
    expect(selectedEntry(state)?.label).toBe('com.example.a02');
  });

  it('toggles Apple entries and keeps the selected entry', () => {
    const state = run(loaded(), char('j'), char('s'));
    expect(state.showApple).toBe(true);
    expect(rowsOf(state)).toHaveLength(31);
    expect(selectedEntry(state)?.label).toBe('com.example.a01');
  });
});

describe('update: actions', () => {
  it('asks for confirmation before a launchctl action and runs it on y', () => {
    const asking = run(loaded(), char('e'));
    expect(asking.mode).toBe('confirm');
    expect(asking.pending?.command.args).toEqual([
      'disable',
      'gui/501/com.example.a00',
    ]);
    const confirmed = update(asking, char('y'));
    expect(confirmed.state).toMatchObject({ mode: 'list', pending: undefined });
    expect(confirmed.effects).toEqual([
      { type: 'run', action: asking.pending },
    ]);
  });

  it('cancels on n or Escape', () => {
    const asking = run(loaded(), char('x'));
    expect(run(asking, char('n'))).toMatchObject({
      mode: 'list',
      status: 'Cancelled',
      pending: undefined,
    });
    expect(update(asking, press({ name: 'escape' })).effects).toEqual([]);
  });

  it('runs Finder and clipboard actions without confirmation', () => {
    const result = update(run(loaded(), char('2')), char('o'));
    expect(result.effects).toEqual([
      {
        type: 'run',
        action: expect.objectContaining({
          command: {
            file: 'open',
            args: ['-R', '/Library/LaunchAgents/t.plist'],
          },
        }),
      },
    ]);
  });

  it('shows the reason when an action is not available', () => {
    expect(run(loaded(), char('o')).status).toBe('No file to show');
  });

  it('refreshes after a launchctl action and keeps its message', () => {
    const done = update(loaded(), {
      type: 'actionDone',
      message: 'Done: Start now',
      refresh: true,
    });
    expect(done.state.status).toBe('Done: Start now');
    expect(done.effects).toEqual([{ type: 'collect' }]);
  });
});

describe('update: refresh, quit, overlays', () => {
  it('refreshes on r and clears the message when data arrives', () => {
    const refreshing = update(loaded(), char('r'));
    expect(refreshing.state.status).toBe(REFRESHING);
    expect(refreshing.effects).toEqual([{ type: 'collect' }]);
    const after = update(refreshing.state, {
      type: 'loaded',
      result: { entries: ENTRIES, warnings: [] },
    });
    expect(after.state.status).toBe('');
  });

  it('asks for a state refresh on tick, but not while confirming or loading', () => {
    expect(update(loaded(), { type: 'tick' }).effects).toEqual([
      { type: 'refreshState' },
    ]);
    expect(update(run(loaded(), char('e')), { type: 'tick' }).effects).toEqual(
      [],
    );
    expect(
      update(
        initialState({ uid: 501, cols: 120, rows: 20, showApple: false }),
        { type: 'tick' },
      ).effects,
    ).toEqual([]);
  });

  it('quits on q and ctrl-c, but q is a filter character', () => {
    expect(update(loaded(), char('q')).effects).toEqual([{ type: 'quit' }]);
    expect(update(loaded(), press({ name: 'ctrl-c' })).effects).toEqual([
      { type: 'quit' },
    ]);
    expect(update(run(loaded(), char('/')), char('q')).state.filter).toBe('q');
  });

  it('opens the warnings overlay for the last message even without warnings', () => {
    const clean = loaded({ warnings: [] });
    const nothing = run(clean, char('w'));
    expect(nothing).toMatchObject({ mode: 'list', status: 'No warnings' });
    expect(run(nothing, char('w')).mode).toBe('list');
    expect(run({ ...clean, status: 'Failed: boom' }, char('w')).mode).toBe(
      'warnings',
    );
    expect(run({ ...clean, status: REFRESHING }, char('w'))).toMatchObject({
      mode: 'list',
      status: 'No warnings',
    });
  });

  it('opens warnings and details overlays and closes them with Escape', () => {
    const warnings = run(loaded(), char('w'));
    expect(warnings.mode).toBe('warnings');
    expect(run(warnings, press({ name: 'escape' })).mode).toBe('list');
    expect(run(loaded(), press({ name: 'enter' })).mode).toBe('list');
    expect(run(loaded({ cols: 80 }), press({ name: 'enter' })).mode).toBe(
      'details',
    );
  });
});

describe('update: mouse', () => {
  const click = (x: number, y: number): TuiEvent => ({
    type: 'mouse',
    mouse: { kind: 'press', x, y },
  });

  it('switches tabs by clicking anywhere on the painted tab', () => {
    expect(run(loaded(), click(36, 1)).tab).toBe('periodic');
    expect(run(loaded(), click(35, 1)).tab).toBe('periodic');
    expect(run(loaded(), click(47, 1)).tab).toBe('periodic');
    expect(run(loaded(), click(48, 1)).tab).toBe('startup');
    expect(run(loaded({ tab: 'periodic' }), click(19, 1)).tab).toBe('startup');
    expect(run(loaded({ tab: 'periodic' }), click(10, 1)).tab).toBe('periodic');
  });

  it('sorts by the sortable columns only', () => {
    expect(run(loaded(), click(2, 7)).sort).toEqual({
      key: 'label',
      descending: true,
    });
    expect(run(loaded(), click(25, 7)).sort).toEqual({
      key: 'source',
      descending: false,
    });
    expect(run(loaded(), click(40, 7)).sort).toEqual({
      key: 'state',
      descending: false,
    });
    // Gaps, When (62..71 at 120 columns) and Program (82..99 at 99) do not sort.
    [23, 24, 61, 62, 71].forEach((x) =>
      expect(run(loaded(), click(x, 7)).sort).toEqual(loaded().sort),
    );
    [82, 99].forEach((x) =>
      expect(run(loaded({ cols: 99 }), click(x, 7)).sort).toEqual(
        loaded().sort,
      ),
    );
  });

  it('selects rows from row 8 to the row above the separator', () => {
    expect(run(loaded(), click(5, 8)).selected).toBe(0);
    expect(run(loaded(), click(5, 11)).selected).toBe(3);
    expect(run(loaded(), click(5, 18)).selected).toBe(10);
    [2, 3, 5, 6, 19, 20].forEach((y) =>
      expect(run(loaded({ selected: 2 }), click(5, y)).selected).toBe(2),
    );
    expect(run(loaded(), click(80, 11)).selected).toBe(0);
  });

  it('scrolls with the wheel', () => {
    expect(
      run(loaded(), { type: 'mouse', mouse: { kind: 'wheeldown', x: 5, y: 7 } })
        .selected,
    ).toBe(3);
  });

  it('ignores the mouse outside list mode', () => {
    const filtering = run(loaded(), char('/'));
    expect(run(filtering, click(36, 1)).tab).toBe('startup');
  });
});

describe('update: screen too small', () => {
  const small = (): TuiState => loaded({ cols: 50, rows: 8 });

  it('ignores every key but q and ctrl-c', () => {
    const asked = update(small(), char('e'));
    expect(asked.effects).toEqual([]);
    expect(asked.state.mode).toBe('list');
    const answered = update(asked.state, char('y'));
    expect(answered.effects).toEqual([]);
    expect(answered.state).toEqual(small());
    expect(run(small(), char('j'), char('/'), char('2'))).toEqual(small());
    expect(update(small(), char('r')).effects).toEqual([]);
  });

  it('still quits with q and ctrl-c', () => {
    expect(update(small(), char('q')).effects).toEqual([{ type: 'quit' }]);
    expect(update(small(), press({ name: 'ctrl-c' })).effects).toEqual([
      { type: 'quit' },
    ]);
  });

  it('ignores the mouse', () => {
    expect(
      run(small(), { type: 'mouse', mouse: { kind: 'press', x: 22, y: 1 } }),
    ).toEqual(small());
    expect(
      run(small(), { type: 'mouse', mouse: { kind: 'wheeldown', x: 5, y: 5 } }),
    ).toEqual(small());
  });

  it('accepts keys again after a resize to a usable size', () => {
    const resized = run(small(), { type: 'resize', cols: 120, rows: 20 });
    expect(update(resized, char('e')).state.mode).toBe('confirm');
  });

  it('keeps handling data events', () => {
    const next = update(small(), {
      type: 'loaded',
      result: { entries: ENTRIES.slice(0, 3), warnings: [] },
    });
    expect(rowsOf(next.state)).toHaveLength(3);
    expect(update(small(), { type: 'tick' }).effects).toEqual([
      { type: 'refreshState' },
    ]);
  });
});

describe('update: selection follows the entry', () => {
  const inserted = [...ENTRIES, entry('com.example.a00a')];

  it('after a load that inserts an entry above the selection', () => {
    const before = run(loaded(), ...Array.from({ length: 5 }, () => char('j')));
    expect(selectedEntry(before)?.label).toBe('com.example.a05');
    const after = run(before, {
      type: 'loaded',
      result: { entries: inserted, warnings: [] },
    });
    expect(after.selected).toBe(6);
    expect(selectedEntry(after)?.label).toBe('com.example.a05');
  });

  it('after a state refresh that inserts an entry above the selection', () => {
    const before = run(loaded(), char('j'), char('j'));
    const after = run(before, { type: 'stateRefreshed', entries: inserted });
    expect(after.selected).toBe(3);
    expect(selectedEntry(after)?.label).toBe('com.example.a02');
  });

  it('after a source sort that reorders mixed sources', () => {
    const mixed = [
      entry('com.example.a', { source: 'global-daemon' }),
      entry('com.example.b', { source: 'user-agent' }),
      entry('com.example.c', { source: 'global-agent' }),
    ];
    const state = run(
      loaded(),
      { type: 'loaded', result: { entries: mixed, warnings: [] } },
      char('g'),
      char('j'),
    );
    expect(selectedEntry(state)?.label).toBe('com.example.b');
    const sorted = run(state, char('S'));
    expect(sorted.sort.key).toBe('source');
    expect(rowsOf(sorted).map((row) => row.label)).toEqual([
      'com.example.c',
      'com.example.a',
      'com.example.b',
    ]);
    expect(sorted.selected).toBe(2);
    expect(selectedEntry(sorted)?.label).toBe('com.example.b');
  });
});

describe('update: empty list', () => {
  const empty = (cols = 120): TuiState =>
    run(loaded({ cols }), {
      type: 'loaded',
      result: { entries: [], warnings: [] },
    });

  it.each([
    ['G', char('G')],
    ['End', press({ name: 'end' })],
    ['PgDn', press({ name: 'pagedown' })],
    ['Enter', press({ name: 'enter' })],
    ['e', char('e')],
  ])('%s keeps the selection at 0', (_, event) => {
    [empty(), empty(80)].forEach((state) => {
      const next = update(state, event);
      expect(next.state.selected).toBe(0);
      expect(next.state.scroll).toBe(0);
      expect(next.state.mode).toBe('list');
      expect(next.effects).toEqual([]);
    });
  });
});
