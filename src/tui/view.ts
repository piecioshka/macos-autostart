import {
  describeEntry,
  stateClass,
  type EntryText,
  type StateClass,
} from '../describe.js';
import { cutUnits, sanitize, truncate } from '../render/text.js';
import type { AutostartEntry } from '../types.js';
import {
  commandText,
  planAction,
  type ActionKind,
  type PlannedAction,
} from './actions.js';
import {
  BADGE,
  geometry,
  LIST_TOP,
  tabLabels,
  type Column,
  type ColumnId,
  type Geometry,
} from './geometry.js';
import {
  hasLastMessage,
  rowsOf,
  selectedEntry,
  type Mode,
  type TuiState,
} from './model.js';
import { paint, type Style } from './style.js';

export interface ViewOptions {
  useColor: boolean;
  version: string;
  home: string;
}

interface Segment {
  text: string;
  styles?: Style[];
}

/** A text placed at a 1-based screen column. */
interface Placed extends Segment {
  x: number;
}

/** Everything the main screen's lines are drawn from. */
interface Frame {
  state: TuiState;
  layout: Geometry;
  options: ViewOptions;
  rows: AutostartEntry[];
  /** Side panel lines; line 0 sits on the column header row. */
  panel: Segment[];
}

const SEPARATOR = '│';
const RULE = '─';
const GUTTER = ' ';
const NO_BREAK_SPACE = '\u00a0';
const VALUE_INDENT = '  ';
const PART_GAP = '   ';
const CONFIRM_LINES = 5;
/** Rows above an overlay's body: tabs, blank, mode, blank. */
const OVERLAY_TOP = 4;
/** Rows below an overlay's body: the separator and the footer. */
const OVERLAY_BOTTOM = 2;
const TOO_SMALL = 'Terminal too small (need at least 60x10)';
const LOADING = 'Loading… sfltool may ask for your password (once a day)';
const NO_MATCH = '(no entries match the filter)';
const NO_ENTRIES = '(no entries)';
const NOTHING_SELECTED = 'Nothing selected';
const SEARCH_PLACEHOLDER = 'Search Label, Program, File...';
const CONFIRM_ANSWERS = '[y] yes   [n] no';
const CONFIRM_TITLE = '┌ Confirm ';
const DETAIL_HELP = 'Enter: Detail';
const HELP_SEPARATOR = ' | ';
/** Footer hints in display order; the lower the priority, the sooner a hint is dropped when the footer does not fit. */
const LIST_HINTS: ReadonlyArray<[text: string, priority: number]> = [
  ['/: Search', 9],
  ['S: Sort', 3],
  ['s: Apple', 4],
  ['r: Refresh', 6],
  ['w: Warnings', 2],
  ['x: Unload', 8],
  ['o: Finder', 5],
  ['c: Copy', 1],
  ['q: Quit', 0],
];
const TOGGLE_PRIORITY = 8;
const DETAIL_PRIORITY = 7;
/** Hints before which the `e:` toggle hint is inserted. */
const HINTS_BEFORE_TOGGLE = 5;
const FILTER_HELP = 'Enter: Apply | Esc: Clear | Backspace: Delete';
const CONFIRM_HELP = 'y: Confirm | n: Cancel';
const OVERLAY_HELP = 'Esc: Back';
const MODE_TEXTS: Record<Mode, string> = {
  list: 'Navigation (Press / to search)',
  filter: 'Search (Enter to apply, Esc to clear)',
  confirm: 'Confirm (y to run, n to cancel)',
  details: 'Details (Esc to go back)',
  warnings: 'Warnings (Esc to close)',
};
const BOLD: Style[] = ['bold'];
const DIM: Style[] = ['dim'];
const ACCENT: Style[] = ['accent'];
const BADGE_STYLE: Style[] = ['badge'];
const ACTIVE_TAB: Style[] = ['activeTab'];
const INACTIVE_TAB: Style[] = ['inactiveTab'];
const SELECTED_ROW: Style[] = ['selectedRow'];
const WARNING: Style[] = ['yellow'];
const ACTION_KEYS: ReadonlyArray<[ActionKind, string]> = [
  ['toggle', 'e'],
  ['start', 'u'],
  ['stop', 'x'],
  ['reveal', 'o'],
  ['copy', 'c'],
];
const ACTION_NAMES: Record<ActionKind, string> = {
  toggle: 'disable',
  start: 'start',
  stop: 'unload',
  reveal: 'Finder',
  copy: 'copy',
};

/** Joins styled segments into a line of exactly `width` visible characters. */
function compose(
  segments: Segment[],
  width: number,
  useColor: boolean,
): string {
  let remaining = width;
  const parts = segments.map((segment) => {
    const room = Math.max(remaining, 0);
    const text = cutUnits(segment.text, room);
    // A cut one unit short of an emoji ends the line: pad the gap with a space.
    const pad = text.length < segment.text.length ? room - text.length : 0;
    remaining -= text.length + pad;
    return `${paint(text, segment.styles ?? [], useColor)}${' '.repeat(pad)}`;
  });
  return `${parts.join('')}${' '.repeat(Math.max(remaining, 0))}`;
}

const fit = (text: string, width: number): string =>
  truncate(text, width).padEnd(Math.max(width, 0));

function centered(text: string, width: number): string {
  const shown = truncate(text, width);
  return `${' '.repeat(Math.max(Math.floor((width - shown.length) / 2), 0))}${shown}`;
}

/** Turns texts placed at 1-based columns into segments, filling the gaps with spaces. */
function place(items: Placed[]): Segment[] {
  const segments: Segment[] = [];
  let column = 1;
  items.forEach((item) => {
    if (item.x > column) {
      segments.push({ text: ' '.repeat(item.x - column) });
    }
    segments.push({ text: item.text, styles: item.styles });
    column = Math.max(column, item.x) + item.text.length;
  });
  return segments;
}

/** The last screen line is one shorter: writing the last cell can scroll some terminals. */
const lineWidth = (state: TuiState, index: number): number =>
  Math.max(index === state.rows - 1 ? state.cols - 1 : state.cols, 0);

const STATE_STYLES: Record<StateClass, Style[]> = {
  disabled: ['red'],
  running: ['green'],
  failed: ['yellow'],
  'not-loaded': ['dim'],
  loaded: [],
  unknown: [],
};

const BREAK_AFTER = new Set([' ', ',', '/']);
/** Spaces, including the no-break space between an action key and its name. */
const LEADING_SPACES = /^[ \u00a0]+/;

const isBreak = (char: string | undefined): boolean =>
  char !== undefined && BREAK_AFTER.has(char);

/** Where the first line of `rest` ends: after the last space, comma or slash in `piece` (never before a space), else after `piece`. */
function breakPoint(rest: string, piece: string): number {
  let index = piece.length;
  while (index > 0 && !(isBreak(rest[index - 1]) && rest[index] !== ' ')) {
    index -= 1;
  }
  return index > 0 ? index : piece.length;
}

/**
 * Wraps `text` into lines of at most `width` code units. Lines end after a space, comma
 * or slash; only a token longer than the width is cut. Emoji are never split.
 */
function wrap(text: string, width: number): string[] {
  const size = Math.max(width, 1);
  const lines: string[] = [];
  // No line starts with a space, so none is only spaces.
  let rest = text.replace(LEADING_SPACES, '');
  while (rest !== '') {
    // Never splits an emoji; a width of 1 gives an emoji a line of its own.
    const piece = cutUnits(rest, size) || rest.slice(0, 2);
    const end =
      piece.length < rest.length ? breakPoint(rest, piece) : piece.length;
    lines.push(rest.slice(0, end));
    rest = rest.slice(end).replace(LEADING_SPACES, '');
  }
  return lines.length > 0 ? lines : [''];
}

function actionName(entry: AutostartEntry, kind: ActionKind): string {
  if (kind === 'toggle' && entry.state.disabled) {
    return 'enable';
  }
  if (kind === 'start' && entry.state.loaded !== true) {
    return 'load';
  }
  return ACTION_NAMES[kind];
}

function actionSummary(entry: AutostartEntry, uid: number): string {
  return (
    ACTION_KEYS.filter(([kind]) => planAction(entry, kind, uid).ok)
      // A no-break space keeps each key next to its action when the line wraps.
      .map(([kind, key]) => `${key}${NO_BREAK_SPACE}${actionName(entry, kind)}`)
      .join('  ')
  );
}

/** One field of the details: a title and its (never blank) value. */
interface Field {
  title: string;
  value: string;
}

/** Turns the fields into lines, in one of the three forms below. */
type FieldForm = (field: Field, width: number) => Segment[];

function detailFields(
  entry: AutostartEntry,
  uid: number,
  home: string,
): Field[] {
  const text = describeEntry(entry, { home });
  const fields: Array<[string, string]> = [
    ['Source', text.source],
    ['Triggers', text.when],
    ['State', text.state],
    ['Program', entry.program === undefined ? '' : text.program],
    ['File', text.file],
    ['Actions', actionSummary(entry, uid)],
  ];
  return fields
    .filter(([, value]) => value.trim() !== '')
    .map(([title, value]) => ({ title, value }));
}

/** An accent title, then its value wrapped and indented. */
function titled(field: Field, width: number): Segment[] {
  const lines = wrap(field.value, width - VALUE_INDENT.length).map((line) => ({
    text: `${VALUE_INDENT}${line}`,
  }));
  return [{ text: `${field.title}:`, styles: ACCENT }, ...lines];
}

/** A titled section followed by a blank line. */
const spaced: FieldForm = (field, width) => [
  ...titled(field, width),
  { text: '' },
];

/** `Title:  value` on one line; a longer value goes on under an indent. */
const compact: FieldForm = (field, width) => {
  const text = `${field.title}:  ${field.value}`;
  const [first = ''] = wrap(text, width);
  const rest = text.slice(first.length).replace(LEADING_SPACES, '');
  const more = rest === '' ? [] : wrap(rest, width - VALUE_INDENT.length);
  return [first, ...more.map((line) => `${VALUE_INDENT}${line}`)].map(
    (line) => ({ text: line }),
  );
};

const FIELD_FORMS: ReadonlyArray<[FieldForm, boolean]> = [
  [spaced, true],
  [titled, false],
  [compact, false],
];

/** The lines of one field (or of the label, which has no title). */
interface LineGroup {
  title?: string;
  lines: Segment[];
}

/** The last visible character of `text` becomes `…`. */
function ellipsized(text: string): string {
  const shown = text.trimEnd();
  return `${cutUnits(shown, shown.length - 1)}…`;
}

const isBareTitle = (line: Segment, title: string | undefined): boolean =>
  title !== undefined && line.text.trim() === `${title}:`;

/**
 * The lines of `group` that fit in `room`. A cut group ends with `…`; a group cut down to
 * its bare title is dropped.
 */
function keepLines(group: LineGroup, room: number): Segment[] {
  if (group.lines.length <= room) {
    return group.lines;
  }
  const kept = group.lines.slice(0, Math.max(room, 0));
  const last = kept.at(-1);
  if (!last || isBareTitle(last, group.title)) {
    return [];
  }
  return [...kept.slice(0, -1), { ...last, text: ellipsized(last.text) }];
}

/** Keeps whole groups in order while they fit; the first one that does not is cut, then the rest go. */
function keepInOrder(groups: LineGroup[], height: number): Segment[] {
  const kept: Segment[] = [];
  for (const group of groups) {
    const lines = keepLines(group, height - kept.length);
    kept.push(...lines);
    if (lines.length < group.lines.length) {
      break;
    }
  }
  return kept;
}

/** When nothing else fits, Actions stays: the other lines give way first. */
function pinActions(
  label: Segment[],
  fields: Field[],
  width: number,
  height: number,
): Segment[] {
  const group = (field: Field): LineGroup => ({
    title: field.title,
    lines: compact(field, width),
  });
  const isActions = (field: Field): boolean => field.title === 'Actions';
  const actions = keepInOrder(fields.filter(isActions).map(group), height);
  const others = [
    { lines: label },
    ...fields.filter((field) => !isActions(field)).map(group),
  ];
  return [...keepInOrder(others, height - actions.length), ...actions];
}

/**
 * The label and the fields in the roomiest form that fits `height` lines: sections
 * with blank lines, sections without them, then one line per field.
 */
function fitDetails(
  label: Segment[],
  fields: Field[],
  width: number,
  height: number,
): Segment[] {
  for (const [form, blank] of FIELD_FORMS) {
    const head = blank ? [...label, { text: '' }] : label;
    const lines = [...head, ...fields.flatMap((field) => form(field, width))];
    if (lines.length <= height) {
      return lines;
    }
  }
  return pinActions(label, fields, width, height);
}

/** The selected entry as styled lines of at most `width` characters and `height` lines. */
function detailSegments(
  state: TuiState,
  width: number,
  home: string,
  height: number,
): Segment[] {
  const entry = selectedEntry(state);
  if (!entry) {
    return [{ text: NOTHING_SELECTED }];
  }
  const label = wrap(sanitize(entry.label), width).map((text) => ({
    text,
    styles: BOLD,
  }));
  const fields = detailFields(entry, state.uid, home);
  return fitDetails(label, fields, width, height);
}

/**
 * The details of the selected entry: the label, then a titled section per field,
 * made more compact when they do not fit in `height` lines.
 */
export function detailLines(
  state: TuiState,
  width: number,
  home: string,
  height = Infinity,
): string[] {
  return detailSegments(state, width, home, height).map(
    (segment) => segment.text,
  );
}

/** Row 1: the program badge, then the numbered tabs. */
function tabLine(state: TuiState, useColor: boolean): string {
  const tabs: Placed[] = tabLabels().map((label) => ({
    x: label.x - 1,
    text: ` ${label.text} `,
    styles: label.tab === state.tab ? ACTIVE_TAB : INACTIVE_TAB,
  }));
  const items = [{ x: 1, text: BADGE, styles: BADGE_STYLE }, ...tabs];
  return compose(place(items), lineWidth(state, 0), useColor);
}

function warningCount(count: number): string {
  return `${count} ${count === 1 ? 'warning' : 'warnings'} (w)`;
}

/** Row 3: the mode and its keys, the last message, the warning count. */
function modeLine(state: TuiState, useColor: boolean): string {
  const parts: Segment[] = [
    { text: ' ' },
    { text: 'Mode:', styles: ACCENT },
    { text: ` ${MODE_TEXTS[state.mode]}` },
  ];
  if (state.status !== '') {
    parts.push({ text: PART_GAP }, { text: sanitize(state.status) });
  }
  if (state.warnings.length > 0) {
    parts.push(
      { text: PART_GAP },
      { text: warningCount(state.warnings.length), styles: WARNING },
    );
  }
  return compose(parts, lineWidth(state, 2), useColor);
}

function searchText(state: TuiState): Segment[] {
  const filter = sanitize(state.filter);
  if (state.mode === 'filter') {
    return [{ text: filter }, { text: '_', styles: BOLD }];
  }
  return filter === ''
    ? [{ text: SEARCH_PLACEHOLDER, styles: DIM }]
    : [{ text: filter }];
}

/** Row 5: the filter, a placeholder while it is empty. */
function searchLine(state: TuiState, useColor: boolean): string {
  const segments = [
    { text: ' ' },
    { text: '> ', styles: ACCENT },
    ...searchText(state),
  ];
  return compose(segments, lineWidth(state, 4), useColor);
}

const blankLine = (state: TuiState, index: number): string =>
  ' '.repeat(lineWidth(state, index));

/** Adds the side panel (when there is one) to the list part of a line. */
function withPanel(list: string, panel: Segment, frame: Frame): string {
  const { detailsWidth } = frame.layout;
  if (detailsWidth === 0) {
    return list;
  }
  const line = compose(
    [{ text: GUTTER }, panel],
    detailsWidth,
    frame.options.useColor,
  );
  return `${list}${SEPARATOR}${line}`;
}

function columnTitle(column: Column, state: TuiState): string {
  if (column.key !== state.sort.key) {
    return column.title;
  }
  return `${column.title} ${state.sort.descending ? '↓' : '↑'}`;
}

/** Row 7: the column titles, the sort arrow on the sorted one. */
function headerLine(frame: Frame): string {
  const { state, layout, options } = frame;
  const items: Placed[] = layout.columns.map((column) => ({
    x: column.x,
    text: truncate(columnTitle(column, state), column.width),
    styles: ACCENT,
  }));
  const list = compose(place(items), layout.listWidth, options.useColor);
  return withPanel(list, frame.panel[0] ?? { text: '' }, frame);
}

function cellText(text: EntryText, id: ColumnId): string {
  const texts: Record<ColumnId, string> = {
    label: text.label,
    source: text.source,
    state: text.state,
    when: text.when,
    program: text.program,
  };
  return texts[id];
}

function entryRow(
  frame: Frame,
  entry: AutostartEntry,
  selected: boolean,
): string {
  const { layout, options } = frame;
  const text = describeEntry(entry, {
    home: options.home,
    group: frame.state.tab,
  });
  const items: Placed[] = layout.columns.map((column) => ({
    x: column.x,
    text: truncate(cellText(text, column.id), column.width),
    styles:
      column.id === 'state' && !selected
        ? STATE_STYLES[stateClass(entry.state)]
        : [],
  }));
  const line = compose(place(items), layout.listWidth, options.useColor);
  // The cells of a selected row carry no styles, so one paint covers the whole row.
  return selected ? paint(line, SELECTED_ROW, options.useColor) : line;
}

function emptyMessage(state: TuiState): string {
  if (state.loading) {
    return LOADING;
  }
  return state.filter === '' ? NO_ENTRIES : NO_MATCH;
}

function emptyRow(frame: Frame, index: number): string {
  const { state, layout, rows } = frame;
  const middle = Math.floor((layout.listHeight - 1) / 2);
  const message =
    rows.length === 0 && index === middle ? emptyMessage(state) : '';
  return fit(centered(message, layout.listWidth), layout.listWidth);
}

/** List line `index` (0-based from LIST_TOP): an entry row or blank, plus the panel. */
function listLine(frame: Frame, index: number): string {
  const { state } = frame;
  const position = state.scroll + index;
  const entry = frame.rows[position];
  const list = entry
    ? entryRow(frame, entry, position === state.selected)
    : emptyRow(frame, index);
  return withPanel(list, frame.panel[index + 1] ?? { text: '' }, frame);
}

function separatorLine(state: TuiState, useColor: boolean): string {
  const width = lineWidth(state, state.rows - 2);
  return compose([{ text: RULE.repeat(width), styles: DIM }], width, useColor);
}

/** All list hints for this state: `Enter: Detail` only without the side panel, `e:` named after what it does to the selected job. */
function listHints(state: TuiState): Array<[string, number]> {
  const panel = geometry(state.cols, state.rows).detailsWidth > 0;
  const selected = selectedEntry(state);
  const toggle = selected?.state.disabled ? 'e: Enable' : 'e: Disable';
  const start = selected?.state.loaded === true ? 'u: Start' : 'u: Load';
  const detail: Array<[string, number]> = panel
    ? []
    : [[DETAIL_HELP, DETAIL_PRIORITY]];
  return [
    ...detail,
    ...LIST_HINTS.slice(0, HINTS_BEFORE_TOGGLE),
    [toggle, TOGGLE_PRIORITY],
    [start, TOGGLE_PRIORITY],
    ...LIST_HINTS.slice(HINTS_BEFORE_TOGGLE),
  ];
}

/** Drops the least important hints, one at a time, until the footer fits in `width`. */
function fitHints(
  prefix: string,
  hints: Array<[string, number]>,
  width: number,
): string {
  const kept = [...hints];
  const text = (): string =>
    `${prefix}${kept.map(([hint]) => hint).join(HELP_SEPARATOR)}`;
  while (kept.length > 0 && text().length > width) {
    const lowest = kept.reduce((low, hint) => (hint[1] < low[1] ? hint : low));
    kept.splice(kept.indexOf(lowest), 1);
  }
  return text();
}

function listHelp(state: TuiState, width: number): string {
  return fitHints(`Total: ${rowsOf(state).length} | `, listHints(state), width);
}

function helpText(state: TuiState, width: number): string {
  if (state.mode === 'filter') {
    return FILTER_HELP;
  }
  if (state.mode === 'confirm') {
    return CONFIRM_HELP;
  }
  return state.mode === 'list' ? listHelp(state, width) : OVERLAY_HELP;
}

/** The last row: the keys of the mode, the version on the right when it fits. */
function footerLine(state: TuiState, options: ViewOptions): string {
  const width = lineWidth(state, state.rows - 1);
  const help = ` ${helpText(state, width - 1)}`;
  const version = `v${options.version}`;
  const text =
    help.length + 1 + version.length <= width
      ? `${help.padEnd(width - version.length)}${version}`
      : help;
  return compose([{ text, styles: DIM }], width, options.useColor);
}

function confirmBox(
  state: TuiState,
  action: PlannedAction,
  useColor: boolean,
): string[] {
  const body = [
    sanitize(commandText(action.command)),
    sanitize(action.description),
    CONFIRM_ANSWERS,
  ];
  const longest = Math.max(...body.map((line) => line.length));
  const width = Math.min(state.cols - 4, longest + 4);
  const box = [
    `${CONFIRM_TITLE}${RULE.repeat(Math.max(width - CONFIRM_TITLE.length - 1, 0))}┐`,
    ...body.map((line) => `│ ${fit(line, width - 4)} │`),
    `└${RULE.repeat(Math.max(width - 2, 0))}┘`,
  ];
  const left = ' '.repeat(Math.max(Math.floor((state.cols - width) / 2), 0));
  return box.map((line) =>
    compose([{ text: left }, { text: line }], state.cols, useColor),
  );
}

/** Draws the confirmation box over the middle of the list area, replacing whole lines. */
function withConfirm(frame: Frame, lines: string[]): string[] {
  const { state, layout, options } = frame;
  if (state.mode !== 'confirm' || state.pending === undefined) {
    return lines;
  }
  const box = confirmBox(state, state.pending, options.useColor);
  const offset = Math.max(
    Math.floor((layout.listHeight - CONFIRM_LINES) / 2),
    0,
  );
  // On a short screen the box moves up, but it never covers the footer.
  const top = Math.max(
    Math.min(LIST_TOP - 1 + offset, state.rows - 1 - CONFIRM_LINES),
    0,
  );
  const footer = state.rows - 1;
  return lines.map((line, index) =>
    index >= top && index < footer ? (box[index - top] ?? line) : line,
  );
}

/** Rows 1 to 4: the tabs and the mode line, each followed by a blank row. */
function topLines(state: TuiState, useColor: boolean): string[] {
  return [
    tabLine(state, useColor),
    blankLine(state, 1),
    modeLine(state, useColor),
    blankLine(state, 3),
  ];
}

/** The side panel runs from the header row to the last list row. */
function panelLines(
  state: TuiState,
  layout: Geometry,
  home: string,
): Segment[] {
  if (layout.detailsWidth === 0) {
    return [];
  }
  // Two columns less than the panel: the gutter and a right margin.
  const width = layout.detailsWidth - 2;
  return detailSegments(state, width, home, layout.listHeight + 1);
}

function mainScreen(
  state: TuiState,
  layout: Geometry,
  options: ViewOptions,
): string[] {
  const panel = panelLines(state, layout, options.home);
  const frame: Frame = { state, layout, options, rows: rowsOf(state), panel };
  const list = Array.from({ length: layout.listHeight }, (_, index) =>
    listLine(frame, index),
  );
  const lines = [
    ...topLines(state, options.useColor),
    searchLine(state, options.useColor),
    blankLine(state, 5),
    headerLine(frame),
    ...list,
    separatorLine(state, options.useColor),
    footerLine(state, options),
  ];
  return withConfirm(frame, lines);
}

function tooSmallScreen(state: TuiState): string[] {
  const middle = Math.floor((state.rows - 1) / 2);
  return Array.from({ length: state.rows }, (_, index) => {
    const width = lineWidth(state, index);
    return fit(index === middle ? centered(TOO_SMALL, width) : '', width);
  });
}

/** A full-screen page: the top rows, the body from row 5, the separator and the footer. */
function overlayScreen(
  state: TuiState,
  body: Segment[],
  options: ViewOptions,
): string[] {
  const { useColor } = options;
  const height = Math.max(state.rows - OVERLAY_TOP - OVERLAY_BOTTOM, 0);
  const page = Array.from({ length: height }, (_, index) =>
    compose(
      [{ text: GUTTER }, body[index] ?? { text: '' }],
      state.cols,
      useColor,
    ),
  );
  return [
    ...topLines(state, useColor),
    ...page,
    separatorLine(state, useColor),
    footerLine(state, options),
  ];
}

/** Wrapped text with a one-column margin on both sides. */
const wrapped = (text: string, cols: number): Segment[] =>
  wrap(sanitize(text), cols - 2).map((line) => ({ text: line }));

function lastMessageLines(state: TuiState): Segment[] {
  if (!hasLastMessage(state.status)) {
    return [];
  }
  return [
    { text: 'Last message:', styles: ACCENT },
    ...wrapped(state.status, state.cols),
    { text: '' },
  ];
}

/** The full last message (the mode line may cut it), then every warning. */
function warningLines(state: TuiState): Segment[] {
  return [
    ...lastMessageLines(state),
    ...state.warnings.flatMap((warning) => wrapped(warning, state.cols)),
  ];
}

export function render(state: TuiState, options: ViewOptions): string[] {
  const layout = geometry(state.cols, state.rows);
  if (layout.tooSmall) {
    return tooSmallScreen(state);
  }
  if (state.mode === 'warnings') {
    return overlayScreen(state, warningLines(state), options);
  }
  if (state.mode === 'details') {
    const height = state.rows - OVERLAY_TOP - OVERLAY_BOTTOM;
    const body = detailSegments(state, state.cols - 2, options.home, height);
    return overlayScreen(state, body, options);
  }
  return mainScreen(state, layout, options);
}
