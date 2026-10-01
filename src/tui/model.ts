import type { AutostartEntry, CollectResult } from '../types.js';
import { planAction, type ActionKind, type PlannedAction } from './actions.js';
import { geometry, HEADER_ROW, LIST_TOP, tabLabels } from './geometry.js';
import type { Key, KeyName, Mouse } from './input.js';
import {
  entryKey,
  SORT_KEYS,
  TABS,
  visibleRows,
  type Sort,
  type SortKey,
  type Tab,
} from './rows.js';

export type Mode = 'list' | 'filter' | 'confirm' | 'details' | 'warnings';

export interface TuiState {
  tab: Tab;
  entries: AutostartEntry[];
  warnings: string[];
  loading: boolean;
  selected: number;
  scroll: number;
  filter: string;
  mode: Mode;
  sort: Sort;
  showApple: boolean;
  status: string;
  pending?: PlannedAction;
  uid: number;
  cols: number;
  rows: number;
}

export type TuiEvent =
  | { type: 'key'; key: Key }
  | { type: 'mouse'; mouse: Mouse }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'loaded'; result: CollectResult }
  | { type: 'stateRefreshed'; entries: AutostartEntry[] }
  | { type: 'actionDone'; message: string; refresh: boolean }
  | { type: 'tick' };

export type Effect =
  | { type: 'collect' }
  | { type: 'refreshState' }
  | { type: 'run'; action: PlannedAction }
  | { type: 'quit' };

export interface Update {
  state: TuiState;
  effects: Effect[];
}

type Handler = (state: TuiState) => Update;

export const REFRESHING = 'Refreshing…';
const WHEEL_STEP = 3;
const NO_WARNINGS = 'No warnings';

export function initialState(options: {
  uid: number;
  cols: number;
  rows: number;
  showApple: boolean;
}): TuiState {
  return {
    tab: 'startup',
    entries: [],
    warnings: [],
    loading: true,
    selected: 0,
    scroll: 0,
    filter: '',
    mode: 'list',
    sort: { key: 'label', descending: false },
    showApple: options.showApple,
    status: '',
    uid: options.uid,
    cols: options.cols,
    rows: options.rows,
  };
}

export function rowsOf(state: TuiState): AutostartEntry[] {
  return visibleRows(state.entries, state);
}

export function selectedEntry(state: TuiState): AutostartEntry | undefined {
  return rowsOf(state)[state.selected];
}

const only = (state: TuiState): Update => ({ state, effects: [] });
const quit = (state: TuiState): Update => ({
  state,
  effects: [{ type: 'quit' }],
});

function listHeight(state: TuiState): number {
  return Math.max(1, geometry(state.cols, state.rows).listHeight);
}

function clamp(state: TuiState): TuiState {
  const count = rowsOf(state).length;
  const height = listHeight(state);
  const selected = Math.min(
    Math.max(state.selected, 0),
    Math.max(count - 1, 0),
  );
  let scroll = Math.min(state.scroll, selected);
  if (selected >= scroll + height) {
    scroll = selected - height + 1;
  }
  scroll = Math.max(0, Math.min(scroll, Math.max(count - height, 0)));
  return { ...state, selected, scroll };
}

/** Keeps the entry that was selected in `previous` selected in `next`, when it is still visible. */
function reselect(previous: TuiState, next: TuiState): TuiState {
  const was = selectedEntry(previous);
  const index = was
    ? rowsOf(next).findIndex((row) => entryKey(row) === entryKey(was))
    : -1;
  return clamp(index === -1 ? next : { ...next, selected: index });
}

const moveTo = (state: TuiState, index: number): TuiState =>
  clamp({ ...state, selected: index });

function switchTab(state: TuiState, tab: Tab): TuiState {
  return clamp({ ...state, tab, selected: 0, scroll: 0, status: '' });
}

function shiftTab(state: TuiState, step: number): TuiState {
  const index = TABS.indexOf(state.tab);
  return switchTab(
    state,
    TABS[(index + step + TABS.length) % TABS.length] ?? 'startup',
  );
}

function sortBy(state: TuiState, key: SortKey): TuiState {
  const descending = state.sort.key === key ? !state.sort.descending : false;
  return reselect(state, { ...state, sort: { key, descending } });
}

function nextSort(state: TuiState): TuiState {
  const index = SORT_KEYS.indexOf(state.sort.key);
  const key = SORT_KEYS[(index + 1) % SORT_KEYS.length] ?? 'label';
  return reselect(state, { ...state, sort: { key, descending: false } });
}

function startAction(state: TuiState, kind: ActionKind): Update {
  const entry = selectedEntry(state);
  if (!entry) {
    return only({ ...state, status: 'Nothing selected' });
  }
  const plan = planAction(entry, kind, state.uid);
  if (!plan.ok) {
    return only({ ...state, status: plan.reason });
  }
  if (plan.action.needsConfirm) {
    return only({ ...state, mode: 'confirm', pending: plan.action });
  }
  return {
    state: { ...state, status: `${plan.action.description}…` },
    effects: [{ type: 'run', action: plan.action }],
  };
}

function openDetails(state: TuiState): Update {
  const narrow = geometry(state.cols, state.rows).detailsWidth === 0;
  return only(
    narrow && selectedEntry(state) ? { ...state, mode: 'details' } : state,
  );
}

/** A status worth repeating on the warnings page: not empty, not a refresh or no-warnings note. */
export function hasLastMessage(status: string): boolean {
  return status !== '' && status !== NO_WARNINGS && status !== REFRESHING;
}

/** The warnings page also shows the full last message, so it opens for either. */
function openWarnings(state: TuiState): Update {
  return only(
    state.warnings.length > 0 || hasLastMessage(state.status)
      ? { ...state, mode: 'warnings' }
      : { ...state, status: NO_WARNINGS },
  );
}

const LIST_CHARS = new Map<string, Handler>([
  ['q', quit],
  ['1', (s) => only(switchTab(s, 'startup'))],
  ['2', (s) => only(switchTab(s, 'periodic'))],
  ['j', (s) => only(moveTo(s, s.selected + 1))],
  ['k', (s) => only(moveTo(s, s.selected - 1))],
  ['g', (s) => only(moveTo(s, 0))],
  ['G', (s) => only(moveTo(s, rowsOf(s).length - 1))],
  ['/', (s) => only({ ...s, mode: 'filter' })],
  ['S', (s) => only(nextSort(s))],
  ['s', (s) => only(reselect(s, { ...s, showApple: !s.showApple }))],
  [
    'r',
    (s) => ({
      state: { ...s, status: REFRESHING },
      effects: [{ type: 'collect' }],
    }),
  ],
  ['w', openWarnings],
  ['e', (s) => startAction(s, 'toggle')],
  ['u', (s) => startAction(s, 'start')],
  ['x', (s) => startAction(s, 'stop')],
  ['o', (s) => startAction(s, 'reveal')],
  ['c', (s) => startAction(s, 'copy')],
]);

const LIST_KEYS = new Map<KeyName, Handler>([
  ['ctrl-c', quit],
  ['up', (s) => only(moveTo(s, s.selected - 1))],
  ['down', (s) => only(moveTo(s, s.selected + 1))],
  ['pageup', (s) => only(moveTo(s, s.selected - listHeight(s)))],
  ['pagedown', (s) => only(moveTo(s, s.selected + listHeight(s)))],
  ['home', (s) => only(moveTo(s, 0))],
  ['end', (s) => only(moveTo(s, rowsOf(s).length - 1))],
  ['left', (s) => only(shiftTab(s, -1))],
  ['right', (s) => only(shiftTab(s, 1))],
  ['tab', (s) => only(shiftTab(s, 1))],
  ['backtab', (s) => only(shiftTab(s, -1))],
  ['enter', openDetails],
]);

function onListKey(state: TuiState, key: Key): Update {
  const handler =
    key.name === 'char' ? LIST_CHARS.get(key.char) : LIST_KEYS.get(key.name);
  return handler ? handler(state) : only(state);
}

function onFilterKey(state: TuiState, key: Key): Update {
  if (key.name === 'char') {
    return only(
      clamp({
        ...state,
        filter: state.filter + key.char,
        selected: 0,
        scroll: 0,
      }),
    );
  }
  if (key.name === 'backspace') {
    return only(
      clamp({
        ...state,
        filter: state.filter.slice(0, -1),
        selected: 0,
        scroll: 0,
      }),
    );
  }
  if (key.name === 'enter') {
    return only({ ...state, mode: 'list' });
  }
  if (key.name === 'escape') {
    return only(
      clamp({ ...state, mode: 'list', filter: '', selected: 0, scroll: 0 }),
    );
  }
  return only(state);
}

function onConfirmKey(state: TuiState, key: Key): Update {
  const { pending } = state;
  const answer = key.name === 'char' ? key.char : key.name;
  if (answer === 'y' && pending) {
    const next: TuiState = {
      ...state,
      mode: 'list',
      pending: undefined,
      status: `${pending.description}…`,
    };
    return { state: next, effects: [{ type: 'run', action: pending }] };
  }
  if (answer === 'n' || answer === 'escape') {
    return only({
      ...state,
      mode: 'list',
      pending: undefined,
      status: 'Cancelled',
    });
  }
  return only(state);
}

function onOverlayKey(state: TuiState, key: Key): Update {
  const closes =
    key.name === 'escape' ||
    key.name === 'enter' ||
    (key.name === 'char' && key.char === 'q');
  return only(closes ? { ...state, mode: 'list' } : state);
}

const tooSmall = (state: TuiState): boolean =>
  geometry(state.cols, state.rows).tooSmall;

function onKey(state: TuiState, key: Key): Update {
  if (key.name === 'ctrl-c') {
    return quit(state);
  }
  if (tooSmall(state)) {
    // Nothing but the size hint is on screen, so only quitting makes sense.
    const isQuit = key.name === 'char' && key.char === 'q';
    return isQuit ? quit(state) : only(state);
  }
  if (state.mode === 'filter') {
    return onFilterKey(state, key);
  }
  if (state.mode === 'confirm') {
    return onConfirmKey(state, key);
  }
  if (state.mode === 'details' || state.mode === 'warnings') {
    return onOverlayKey(state, key);
  }
  return onListKey(state, key);
}

function clickTab(state: TuiState, x: number): TuiState {
  const label = tabLabels().find(
    (tab) => x >= tab.x - 1 && x <= tab.x + tab.text.length,
  );
  return label ? switchTab(state, label.tab) : state;
}

function clickHeader(state: TuiState, x: number): TuiState {
  const column = geometry(state.cols, state.rows).columns.find(
    (col) => x >= col.x && x < col.x + col.width,
  );
  // When and Program are not sortable.
  return column?.key ? sortBy(state, column.key) : state;
}

function clickRow(state: TuiState, x: number, y: number): TuiState {
  const layout = geometry(state.cols, state.rows);
  const index = state.scroll + (y - LIST_TOP);
  const inList =
    y >= LIST_TOP && y < LIST_TOP + layout.listHeight && x <= layout.listWidth;
  return inList && index < rowsOf(state).length ? moveTo(state, index) : state;
}

function onMouse(state: TuiState, mouse: Mouse): Update {
  if (state.mode !== 'list' || tooSmall(state)) {
    return only(state);
  }
  if (mouse.kind === 'wheelup') {
    return only(moveTo(state, state.selected - WHEEL_STEP));
  }
  if (mouse.kind === 'wheeldown') {
    return only(moveTo(state, state.selected + WHEEL_STEP));
  }
  if (mouse.y === 1) {
    return only(clickTab(state, mouse.x));
  }
  return only(
    mouse.y === HEADER_ROW
      ? clickHeader(state, mouse.x)
      : clickRow(state, mouse.x, mouse.y),
  );
}

function onLoaded(state: TuiState, result: CollectResult): Update {
  const status = state.status === REFRESHING ? '' : state.status;
  const next = {
    ...state,
    entries: result.entries,
    warnings: result.warnings,
    loading: false,
    status,
  };
  return only(reselect(state, next));
}

function onTick(state: TuiState): Update {
  const busy = state.mode === 'confirm' || state.loading;
  return busy ? only(state) : { state, effects: [{ type: 'refreshState' }] };
}

export function update(state: TuiState, event: TuiEvent): Update {
  if (event.type === 'key') {
    return onKey(state, event.key);
  }
  if (event.type === 'mouse') {
    return onMouse(state, event.mouse);
  }
  if (event.type === 'resize') {
    return only(clamp({ ...state, cols: event.cols, rows: event.rows }));
  }
  if (event.type === 'loaded') {
    return onLoaded(state, event.result);
  }
  if (event.type === 'stateRefreshed') {
    return only(reselect(state, { ...state, entries: event.entries }));
  }
  if (event.type === 'actionDone') {
    const effects: Effect[] = event.refresh ? [{ type: 'collect' }] : [];
    return { state: { ...state, status: event.message }, effects };
  }
  return onTick(state);
}
