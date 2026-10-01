import { describeEntry, groupEntries, type EntryGroup } from '../describe.js';
import type { AutostartEntry } from '../types.js';
import { truncate } from './text.js';

export interface TableOptions {
  width: number;
  home: string;
}

const HEADERS = ['Label', 'Source', 'When', 'State', 'Program'];
const INDENT = '  ';
const GAP = '  ';
const MIN_PROGRAM_WIDTH = 20;
const MIN_LABEL_WIDTH = 24;
const MIN_WHEN_WIDTH = 20;
const LABEL = 0;
const WHEN = 2;
const PROGRAM = 4;
/** Columns that give up space when a line is too wide, in this order, with their minimum widths. */
const SHRINKABLE: ReadonlyArray<[column: number, minimum: number]> = [
  [WHEN, MIN_WHEN_WIDTH],
  [LABEL, MIN_LABEL_WIDTH],
  [PROGRAM, MIN_PROGRAM_WIDTH],
];

function toRow(
  entry: AutostartEntry,
  group: EntryGroup,
  home: string,
): string[] {
  const text = describeEntry(entry, { home, group });
  return [text.label, text.source, text.when, text.state, text.program];
}

/** Shrinks When, then Label, then Program until the line fits, never below their minimums. */
function fitWidths(natural: number[], width: number): number[] {
  const widths = [...natural];
  const line = widths.reduce(
    (sum, columnWidth) => sum + columnWidth,
    INDENT.length + GAP.length * (widths.length - 1),
  );
  let overflow = line - width;
  for (const [column, minimum] of SHRINKABLE) {
    const current = widths[column] ?? 0;
    const cut = Math.max(0, Math.min(overflow, current - minimum));
    widths[column] = current - cut;
    overflow -= cut;
  }
  return widths;
}

function layout(rows: string[][], width: number): string[] {
  const all = [HEADERS, ...rows];
  const natural = HEADERS.map((_, column) =>
    Math.max(...all.map((row) => (row[column] ?? '').length)),
  );
  const widths = fitWidths(natural, width);
  return all.map((row) => {
    const cells = row.map((cell, column) => {
      const columnWidth = widths[column] ?? 0;
      return truncate(cell, columnWidth).padEnd(columnWidth);
    });
    return `${INDENT}${cells.join(GAP)}`.trimEnd();
  });
}

function renderSection(title: string, rows: string[][], width: number): string {
  const body = rows.length > 0 ? layout(rows, width) : [`${INDENT}(none)`];
  return [`${title} (${rows.length})`, ...body].join('\n');
}

export function renderTable(
  entries: AutostartEntry[],
  options: TableOptions,
): string {
  const groups = groupEntries(entries);
  const startup = groups.atStartup.map((entry) =>
    toRow(entry, 'startup', options.home),
  );
  const periodic = groups.periodic.map((entry) =>
    toRow(entry, 'periodic', options.home),
  );
  const first = renderSection('At startup', startup, options.width);
  const second = renderSection('Periodic', periodic, options.width);
  return `${first}\n\n${second}\n`;
}
