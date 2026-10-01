import { TAB_TITLES, TABS, type SortKey, type Tab } from './rows.js';

export const MIN_COLS = 60;
export const MIN_ROWS = 10;
/** From here on the list keeps at least 70 columns next to the side panel. */
export const SIDE_PANEL_MIN_COLS = 117;
/**
 * 1-based screen rows: 1 badge and tabs, 3 mode, 5 search, 7 column headers,
 * 8 .. rows-2 list, rows-1 separator, rows footer (2, 4 and 6 stay blank).
 */
export const HEADER_ROW = 7;
export const LIST_TOP = 8;
/** The program name painted at the left of row 1. */
export const BADGE = ' macos-autostart ';

/** The separator and the footer below the list. */
const BOTTOM_ROWS = 2;
const SOURCE_WIDTH = 13;
const STATE_WIDTH = 20;
const LABEL_MIN_WIDTH = 20;
const WHEN_MIN_WIDTH = 10;
const PROGRAM_MIN_WIDTH = 12;
const LABEL_SHARE = 0.45;
const WHEN_SHARE = 0.25;
const GAP = 2;
const INDENT = 1;
const DETAILS_SHARE = 0.4;
/** One gap after the badge, then the tab's own leading space. */
const FIRST_TAB_X = 1 + BADGE.length + 1 + 1;
/** A tab's trailing space, one gap, the next tab's leading space. */
const TAB_GAP = 3;

export type ColumnId = 'label' | 'source' | 'state' | 'when' | 'program';

export interface Column {
  id: ColumnId;
  /** The sort key of a sortable column. */
  key: SortKey | undefined;
  title: string;
  /** 1-based first column. */
  x: number;
  width: number;
}

export interface Geometry {
  cols: number;
  rows: number;
  tooSmall: boolean;
  listHeight: number;
  listWidth: number;
  /** 1-based first column of the details panel. */
  detailsX: number;
  /** 0 when the screen is too narrow for a side panel. */
  detailsWidth: number;
  columns: Column[];
}

export interface TabLabel {
  tab: Tab;
  /** 1-based column of the first character of `text`. */
  x: number;
  text: string;
}

type ColumnSpec = [id: ColumnId, key: SortKey | undefined, title: string];

const COLUMN_SPECS: readonly ColumnSpec[] = [
  ['label', 'label', 'Label'],
  ['source', 'source', 'Source'],
  ['state', 'state', 'State'],
  ['when', undefined, 'When'],
  ['program', undefined, 'Program'],
];

/** The indent, Source, State and the gaps before them. */
const FIXED_WIDTH = INDENT + GAP + SOURCE_WIDTH + GAP + STATE_WIDTH;
/** List widths from which When, then Program, fit at their minimum widths. */
const WHEN_FROM = FIXED_WIDTH + LABEL_MIN_WIDTH + GAP + WHEN_MIN_WIDTH;
const PROGRAM_FROM = WHEN_FROM + GAP + PROGRAM_MIN_WIDTH;

type Widths = Partial<Record<ColumnId, number>>;

/** Label, When and Program share what is left 45/25/30; Program takes the rounding. */
function sharedWidths(free: number): Widths {
  const label = Math.max(LABEL_MIN_WIDTH, Math.floor(free * LABEL_SHARE));
  const when = Math.max(WHEN_MIN_WIDTH, Math.floor(free * WHEN_SHARE));
  return { label, when, program: free - label - when };
}

/** Program goes first, then When, when their minimum widths do not fit. */
function columnWidths(listWidth: number): Widths {
  const fixed = { source: SOURCE_WIDTH, state: STATE_WIDTH };
  if (listWidth >= PROGRAM_FROM) {
    return { ...fixed, ...sharedWidths(listWidth - FIXED_WIDTH - GAP * 2) };
  }
  if (listWidth >= WHEN_FROM) {
    const label = listWidth - WHEN_FROM + LABEL_MIN_WIDTH;
    return { ...fixed, label, when: WHEN_MIN_WIDTH };
  }
  return { ...fixed, label: Math.max(listWidth - FIXED_WIDTH, 1) };
}

/** The list columns that fit in `listWidth`, left to right. */
export function listColumns(listWidth: number): Column[] {
  const widths = columnWidths(listWidth);
  let x = 1 + INDENT;
  return COLUMN_SPECS.flatMap(([id, key, title]) => {
    const width = widths[id];
    if (width === undefined) {
      return [];
    }
    const column = { id, key, title, x, width };
    x += width + GAP;
    return [column];
  });
}

export function geometry(cols: number, rows: number): Geometry {
  const detailsWidth =
    cols >= SIDE_PANEL_MIN_COLS ? Math.floor(cols * DETAILS_SHARE) : 0;
  const listWidth = detailsWidth > 0 ? cols - detailsWidth - 1 : cols;
  return {
    cols,
    rows,
    tooSmall: cols < MIN_COLS || rows < MIN_ROWS,
    listHeight: Math.max(0, rows - LIST_TOP + 1 - BOTTOM_ROWS),
    listWidth,
    detailsX: listWidth + 2,
    detailsWidth,
    columns: listColumns(listWidth),
  };
}

export function tabLabels(): TabLabel[] {
  let x = FIRST_TAB_X;
  return TABS.map((tab, index) => {
    const text = `${index + 1}. ${TAB_TITLES[tab]}`;
    const label = { tab, x, text };
    x += text.length + TAB_GAP;
    return label;
  });
}
