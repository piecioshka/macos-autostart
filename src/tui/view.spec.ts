import { describe, expect, it } from 'vitest';

import type { AutostartEntry } from '../types.js';
import { geometry, LIST_TOP, tabLabels } from './geometry.js';
import { initialState, update, type Mode, type TuiState } from './model.js';
import { paint, stripStyles } from './style.js';
import { detailLines, render } from './view.js';

const FIRST_ENTRY: AutostartEntry = {
  source: 'user-agent',
  label: 'com.example.agent',
  program: '/Users/example/bin/agent --serve',
  file: '/Users/example/Library/LaunchAgents/com.example.agent.plist',
  triggers: [{ kind: 'load' }, { kind: 'interval', detail: 'every 1 h' }],
  state: { loaded: true, pid: 42 },
};

const ENTRIES: AutostartEntry[] = [
  FIRST_ENTRY,
  {
    source: 'global-daemon',
    label: 'com.example.evil\u001b[2J',
    triggers: [{ kind: 'keepalive' }],
    state: { disabled: true },
  },
];

const OPTIONS = { useColor: true, version: '0.1.0', home: '/Users/example' };

function screen(
  cols: number,
  rows: number,
  patch: Partial<TuiState> = {},
): TuiState {
  const start = initialState({ uid: 501, cols, rows, showApple: false });
  return {
    ...update(start, {
      type: 'loaded',
      result: { entries: ENTRIES, warnings: ['[cron] boom'] },
    }).state,
    ...patch,
  };
}

const plain = (lines: string[]) => lines.map(stripStyles);

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function loadedWith(
  entries: AutostartEntry[],
  warnings: string[],
  cols = 120,
  rows = 20,
): TuiState {
  const start = initialState({ uid: 501, cols, rows, showApple: false });
  return update(start, { type: 'loaded', result: { entries, warnings } }).state;
}

function expectExactWidths(lines: string[], cols: number): void {
  lines.slice(0, -1).forEach((line) => expect(line).toHaveLength(cols));
  expect(lines.at(-1)).toHaveLength(cols - 1);
}

describe('style', () => {
  it('paints and strips', () => {
    expect(paint('x', ['green'], true)).toBe('\u001b[32mx\u001b[0m');
    expect(paint('x', ['green'], false)).toBe('x');
    expect(paint('x', ['inverse', 'red'], false)).toBe('\u001b[7mx\u001b[0m');
    expect(stripStyles('\u001b[1;7mab\u001b[0mc')).toBe('abc');
  });

  it('paints the accent, badge, active tab and selected row colors', () => {
    expect(paint('x', ['accent'], true)).toBe('\u001b[1;35mx\u001b[0m');
    expect(paint('x', ['badge'], true)).toBe('\u001b[48;5;55;97mx\u001b[0m');
    expect(paint('x', ['activeTab'], true)).toBe(
      '\u001b[48;5;28;97mx\u001b[0m',
    );
    expect(paint('x', ['selectedRow'], true)).toBe(
      '\u001b[48;5;55;97mx\u001b[0m',
    );
  });

  it('falls back to inverse and bold without color', () => {
    expect(paint('x', ['badge'], false)).toBe('\u001b[7mx\u001b[0m');
    expect(paint('x', ['activeTab'], false)).toBe('\u001b[7;1mx\u001b[0m');
    expect(paint('x', ['inactiveTab'], true)).toBe('\u001b[7;2mx\u001b[0m');
    expect(paint('x', ['inactiveTab'], false)).toBe('x');
    expect(paint('x', ['selectedRow'], false)).toBe('\u001b[7mx\u001b[0m');
    expect(paint('x', ['accent'], false)).toBe('\u001b[1mx\u001b[0m');
    expect(paint('x', ['inverse', 'dim'], false)).toBe('\u001b[7mx\u001b[0m');
    expect(paint('x', ['selectedRow', 'inverse'], false)).toBe(
      '\u001b[7mx\u001b[0m',
    );
    expect(paint('x', ['dim', 'yellow'], false)).toBe('x');
  });
});

const LIST_HELP =
  'Enter: Detail | /: Search | S: Sort | s: Apple | r: Refresh | w: Warnings | e: Disable | u: Start | x: Unload | o: Finder | c: Copy | q: Quit';
/** The list keys when the side panel already shows the details. */
const PANEL_HELP = LIST_HELP.replace('Enter: Detail | ', '');
const BLUE_ROW = '\u001b[48;5;55;97m';
const RESET = '\u001b[0m';

/** The footer: `text` on the left, the version on the right when both fit. */
const footer = (text: string, width: number): string =>
  `${` ${text}`.padEnd(width - 'v0.1.0'.length)}v0.1.0`;

const asking = (state: TuiState): TuiState =>
  update(state, { type: 'key', key: { name: 'char', char: 'e' } }).state;

describe('render: layout', () => {
  it('fills the screen exactly in every mode and size', () => {
    const sizes: Array<[number, number]> = [
      [60, 10],
      [80, 20],
      [99, 24],
      [100, 12],
      [120, 20],
      [200, 40],
    ];
    sizes.forEach(([cols, rows]) => {
      const states = [
        screen(cols, rows),
        screen(cols, rows, { mode: 'filter', filter: 'ag' }),
        asking(screen(cols, rows)),
        screen(cols, rows, { mode: 'details' }),
        screen(cols, rows, { mode: 'warnings' }),
      ];
      states.forEach((state) => {
        const lines = plain(render(state, OPTIONS));
        expect(lines).toHaveLength(rows);
        expectExactWidths(lines, cols);
      });
    });
  });

  it('draws the badge and the numbered tabs on row 1', () => {
    const raw = render(screen(120, 20), OPTIONS);
    expect(stripStyles(raw[0] ?? '')).toBe(
      ' macos-autostart   1. At startup   2. Periodic '.padEnd(120),
    );
    expect(raw[0]).toContain('\u001b[48;5;55;97m macos-autostart \u001b[0m');
    expect(raw[0]).toContain('\u001b[48;5;28;97m 1. At startup \u001b[0m');
    expect(raw[0]).toContain('\u001b[7;2m 2. Periodic \u001b[0m');
    const periodic = render(screen(120, 20, { tab: 'periodic' }), OPTIONS);
    expect(periodic[0]).toContain('\u001b[48;5;28;97m 2. Periodic \u001b[0m');
    expect(periodic[0]).toContain('\u001b[7;2m 1. At startup \u001b[0m');
  });

  it('tells the active tab apart without color', () => {
    const mono = { ...OPTIONS, useColor: false };
    const startup = render(screen(120, 20), mono)[0] ?? '';
    const periodic = render(screen(120, 20, { tab: 'periodic' }), mono)[0];
    expect(startup).not.toBe(periodic);
    expect(startup).toContain(
      '\u001b[7;1m 1. At startup \u001b[0m  2. Periodic ',
    );
    expect(periodic).toContain(
      '\u001b[0m  1. At startup  \u001b[7;1m 2. Periodic \u001b[0m',
    );
  });

  it('puts every tab text where the mouse looks for it', () => {
    const [line = ''] = plain(render(screen(120, 20), OPTIONS));
    tabLabels().forEach((label) => {
      expect(line.slice(label.x - 1, label.x - 1 + label.text.length)).toBe(
        label.text,
      );
      expect(line[label.x - 2]).toBe(' ');
      expect(line[label.x - 1 + label.text.length]).toBe(' ');
    });
  });

  it('keeps rows 2, 4 and 6 blank', () => {
    const lines = plain(render(screen(120, 20), OPTIONS));
    [1, 3, 5].forEach((index) => expect(lines[index]).toBe(' '.repeat(120)));
  });

  it('draws a dim separator above the footer', () => {
    const raw = render(screen(120, 20), OPTIONS);
    expect(raw[18]).toBe(`\u001b[2m${'─'.repeat(120)}${RESET}`);
  });

  it('drops the side panel below 117 columns', () => {
    const lines = plain(render(screen(116, 20), OPTIONS));
    expect(lines.join('\n')).not.toContain('│');
    expectExactWidths(lines, 116);
    expect(plain(render(screen(117, 20), OPTIONS))[6]?.[70]).toBe('│');
  });

  it('says the terminal is too small', () => {
    const lines = plain(render(screen(50, 8), OPTIONS));
    expect(lines).toHaveLength(8);
    expect(lines.join('\n')).toContain(
      'Terminal too small (need at least 60x10)',
    );
  });

  it('uses no color codes without color, but keeps inverse and bold', () => {
    const text = render(screen(200, 30), { ...OPTIONS, useColor: false }).join(
      '',
    );
    const codes = text
      .split('\u001b[')
      .slice(1)
      .flatMap((part) => part.slice(0, part.indexOf('m')).split(';'));
    expect(new Set(codes)).toEqual(new Set(['0', '1', '7']));
    expect(text).toContain('\u001b[7m macos-autostart ');
    expect(text).toContain('\u001b[1mSource:');
  });
});

describe('render: mode line', () => {
  const modeLine = (state: TuiState): string =>
    plain(render(state, OPTIONS))[2] ?? '';

  it('names the mode and its keys', () => {
    expect(modeLine(screen(120, 20))).toBe(
      ' Mode: Navigation (Press / to search)   1 warning (w)'.padEnd(120),
    );
    expect(modeLine(screen(120, 20, { mode: 'filter' }))).toMatch(
      /^ Mode: Search \(Enter to apply, Esc to clear\) {3}1 warning/,
    );
    expect(modeLine(asking(screen(120, 20)))).toMatch(
      /^ Mode: Confirm \(y to run, n to cancel\) {3}1 warning/,
    );
    expect(modeLine(screen(80, 20, { mode: 'details' }))).toMatch(
      /^ Mode: Details \(Esc to go back\) {3}1 warning/,
    );
    expect(modeLine(screen(120, 20, { mode: 'warnings' }))).toMatch(
      /^ Mode: Warnings \(Esc to close\) {3}1 warning/,
    );
  });

  it('adds the status, then the warning count in yellow', () => {
    const state = screen(120, 20, { status: 'Done: Start now' });
    const raw = render(state, OPTIONS)[2] ?? '';
    expect(stripStyles(raw)).toBe(
      ' Mode: Navigation (Press / to search)   Done: Start now   1 warning (w)'.padEnd(
        120,
      ),
    );
    expect(raw).toContain('\u001b[1;35mMode:\u001b[0m');
    expect(raw).toContain('\u001b[33m1 warning (w)\u001b[0m');
  });

  it('counts warnings with the right plural', () => {
    expect(modeLine(loadedWith(ENTRIES, ['a', 'b']))).toContain(
      '   2 warnings (w)',
    );
    expect(modeLine(loadedWith(ENTRIES, []))).not.toContain('warning');
  });

  it('sanitizes the status text', () => {
    const state = screen(120, 20, { status: 'Failed: x\u001b[2Jy\rz\u009bq' });
    const raw = render(state, OPTIONS);
    expect(stripStyles(raw[2] ?? '')).toContain('Failed: x?[2Jy?z?q');
    expect(raw.join('')).not.toMatch(/[\r\u009b]/);
  });
});

describe('render: search line', () => {
  it('shows a dim placeholder while the filter is empty', () => {
    const raw = render(screen(120, 20), OPTIONS)[4] ?? '';
    expect(stripStyles(raw)).toBe(
      ' > Search Label, Program, File...'.padEnd(120),
    );
    expect(raw).toContain('\u001b[1;35m> \u001b[0m');
    expect(raw).toContain('\u001b[2mSearch Label, Program, File...\u001b[0m');
  });

  it('shows the filter being typed with a cursor', () => {
    const raw = render(
      screen(120, 20, { mode: 'filter', filter: 'ag' }),
      OPTIONS,
    );
    expect(stripStyles(raw[4] ?? '')).toBe(' > ag_'.padEnd(120));
    expect(raw[4]).toContain('ag\u001b[1m_\u001b[0m');
    const empty = render(screen(120, 20, { mode: 'filter' }), OPTIONS);
    expect(stripStyles(empty[4] ?? '')).toBe(' > _'.padEnd(120));
  });

  it('shows an applied filter without a cursor', () => {
    const lines = plain(
      render(screen(120, 20, { filter: 'a\u001b' }), OPTIONS),
    );
    expect(lines[4]).toBe(' > a?'.padEnd(120));
  });
});

describe('render: list', () => {
  it('draws five column headers with the sort arrow on the sorted column', () => {
    const raw = render(screen(200, 30), OPTIONS);
    expect(stripStyles(raw[6] ?? '').slice(0, 119)).toBe(
      ' Label ↑                             Source         State                 When                 Program                 ',
    );
    expect(raw[6]).toContain('\u001b[1;35mLabel ↑\u001b[0m');
    expect(raw[6]).toContain('\u001b[1;35mProgram\u001b[0m');
    const byState = screen(200, 30, {
      sort: { key: 'state', descending: true },
    });
    const line = plain(render(byState, OPTIONS))[6] ?? '';
    expect(line).toMatch(/^ Label +Source +State ↓ +When +Program +│/);
  });

  it('puts every column title where the mouse looks for it', () => {
    [120, 200].forEach((cols) => {
      const line = plain(render(screen(cols, 30), OPTIONS))[6] ?? '';
      geometry(cols, 30).columns.forEach((column) =>
        expect(line.slice(column.x - 1)).toMatch(
          new RegExp(`^${column.title}`),
        ),
      );
    });
  });

  it('draws label, source, state, when and program', () => {
    const lines = plain(render(screen(200, 30), OPTIONS));
    expect(lines[7]?.slice(0, 119).trimEnd()).toBe(
      ' com.example.agent                   user-agent     running (PID 42)      at login             ~/bin/agent --serve',
    );
    expect(lines[8]).toMatch(
      /^ com\.example\.evil\?\[2J +global-daemon +disabled +keep alive +│/,
    );
  });

  it('shows the program, or the file when there is none', () => {
    const noProgram = { ...FIRST_ENTRY, program: undefined };
    const lines = plain(render(loadedWith([noProgram], [], 200, 30), OPTIONS));
    expect(lines[7]).toContain(' ~/Library/LaunchAgents/…│');
  });

  it('shows only the Periodic entries and triggers on the second tab', () => {
    const lines = plain(render(screen(200, 30, { tab: 'periodic' }), OPTIONS));
    expect(lines[7]).toMatch(
      /^ com\.example\.agent +user-agent +running \(PID 42\) +every 1 h /,
    );
    expect(lines.join('\n')).not.toContain('com.example.evil');
  });

  it('paints the selected row across the whole list width', () => {
    const raw = render(screen(200, 30), OPTIONS);
    const row = stripStyles(raw[7] ?? '').slice(0, 119);
    expect(raw[7]?.startsWith(`${BLUE_ROW}${row}${RESET}│`)).toBe(true);
    expect(raw[8]).not.toContain(BLUE_ROW);
    expect(raw[8]).toContain('\u001b[31mdisabled\u001b[0m');
    const mono = render(screen(200, 30), { ...OPTIONS, useColor: false });
    expect(mono[7]?.startsWith(`\u001b[7m${row}${RESET}│`)).toBe(true);
    const narrow = render(screen(80, 20), OPTIONS);
    expect(narrow[7]).toBe(
      `${BLUE_ROW}${stripStyles(narrow[7] ?? '')}${RESET}`,
    );
  });

  it('selects the row the mouse clicked', () => {
    const state = screen(120, 20);
    const y = LIST_TOP + 1;
    const clicked = update(state, {
      type: 'mouse',
      mouse: { kind: 'press', x: 5, y },
    }).state;
    const raw = render(clicked, OPTIONS);
    expect(raw[y - 1]?.startsWith(BLUE_ROW)).toBe(true);
    expect(raw[LIST_TOP - 1]?.startsWith(BLUE_ROW)).toBe(false);
  });

  it('shows loading and empty states on the middle list row', () => {
    const loading = initialState({
      uid: 501,
      cols: 100,
      rows: 12,
      showApple: false,
    });
    expect(plain(render(loading, OPTIONS))[8]).toContain(
      'Loading… sfltool may ask for your password (once a day)',
    );
    expect(
      plain(render(screen(100, 12, { filter: 'zzz' }), OPTIONS))[8],
    ).toContain('(no entries match the filter)');
    expect(plain(render(loadedWith([], [], 100, 12), OPTIONS))[8]).toContain(
      '(no entries)',
    );
  });

  it('draws the confirmation box', () => {
    const lines = plain(render(asking(screen(120, 20)), OPTIONS));
    const text = lines.join('\n');
    expect(text).toContain('launchctl disable gui/501/com.example.agent');
    expect(text).toContain('[y] yes   [n] no');
    expect(lines.at(-1)).toBe(footer('y: Confirm | n: Cancel', 119));
  });

  it('moves the confirmation box up on a short screen, above the footer', () => {
    const lines = plain(render(asking(screen(60, 10)), OPTIONS));
    expectExactWidths(lines, 60);
    expect(lines.slice(4, 9).join('\n')).toContain('[y] yes   [n] no');
    expect(lines[4]).toContain('┌ Confirm ');
    expect(lines.at(-1)).toBe(footer('y: Confirm | n: Cancel', 59));
  });
});

describe('render: columns at every size', () => {
  const LONG: AutostartEntry = {
    source: 'global-agent',
    label: `com.example.${'long'.repeat(12)}`,
    program: `/Library/Application Support/Example/${'bin/'.repeat(10)}tool --flag`,
    triggers: [
      { kind: 'load' },
      { kind: 'keepalive', detail: 'successful exit' },
    ],
    state: { loaded: true, lastExitCode: 78 },
  };
  const VALUES = [
    'com.example.agent',
    'com.example.evil?[2J',
    LONG.label,
    'user-agent',
    'global-daemon',
    'global-agent',
    'running (PID 42)',
    'disabled',
    'exited 78',
    'at login',
    'keep alive',
    'at login, keep alive (successful exit)',
    '~/bin/agent --serve',
    '',
    LONG.program ?? '',
  ];
  const sizes: Array<[number, number, string[]]> = [
    [60, 10, ['Label', 'Source', 'State']],
    [80, 24, ['Label', 'Source', 'State', 'When']],
    [100, 30, ['Label', 'Source', 'State', 'When', 'Program']],
    [110, 30, ['Label', 'Source', 'State', 'When', 'Program']],
    [120, 40, ['Label', 'Source', 'State', 'When']],
    [200, 50, ['Label', 'Source', 'State', 'When', 'Program']],
  ];

  /** A cell shows its whole value, or a cut one that ends with an ellipsis. */
  function expectWholeOrEllipsis(cell: string): void {
    const text = cell.trimEnd();
    const cut =
      text.endsWith('…') &&
      VALUES.some((value) => value.startsWith(text.slice(0, -1)));
    expect(VALUES.includes(text) || cut).toBe(true);
  }

  it.each(sizes)('at %ix%i shows %j', (cols, rows, titles) => {
    const state = loadedWith([...ENTRIES, LONG], [], cols, rows);
    const lines = plain(render(state, OPTIONS));
    const layout = geometry(cols, rows);
    expect(layout.columns.map((column) => column.title)).toEqual(titles);
    const header = lines[LIST_TOP - 2] ?? '';
    titles.forEach((title) => expect(header).toContain(title));
    const shown = Math.min(3, layout.listHeight);
    Array.from({ length: shown }, (_, index) => index).forEach((index) => {
      const line = lines[LIST_TOP - 1 + index] ?? '';
      layout.columns.forEach((column) => {
        expectWholeOrEllipsis(
          line.slice(column.x - 1, column.x - 1 + column.width),
        );
        expect(line[column.x - 2]).toBe(' ');
      });
    });
  });
});

describe('render: side panel', () => {
  it('shows the label and the sections of the selected entry', () => {
    const lines = plain(render(screen(200, 30), OPTIONS));
    expect(lines.slice(6, 28).map((line) => line[119])).toEqual(
      Array.from({ length: 22 }, () => '│'),
    );
    expect(lines.slice(6, 28).map((line) => line.slice(120).trimEnd())).toEqual(
      [
        ' com.example.agent',
        '',
        ' Source:',
        '   user-agent',
        '',
        ' Triggers:',
        '   at login, every 1 h',
        '',
        ' State:',
        '   running (PID 42)',
        '',
        ' Program:',
        '   ~/bin/agent --serve',
        '',
        ' File:',
        '   ~/Library/LaunchAgents/com.example.agent.plist',
        '',
        ' Actions:',
        '   e\u00a0disable  u\u00a0start  x\u00a0unload  o\u00a0Finder  c\u00a0copy',
        '',
        '',
        '',
      ],
    );
    const raw = render(screen(200, 30), OPTIONS);
    expect(raw[6]).toContain('\u001b[1mcom.example.agent\u001b[0m');
    expect(raw[8]).toContain('\u001b[1;35mSource:\u001b[0m');
  });

  it('says Nothing selected without a selection', () => {
    const lines = plain(render(screen(120, 20, { filter: 'zzz' }), OPTIONS));
    expect(lines[6]?.slice(72).trimEnd()).toBe(' Nothing selected');
  });
});

describe('render: footer', () => {
  it('counts the rows of the current tab and lists the keys', () => {
    const lines = plain(render(screen(200, 30), OPTIONS));
    expect(lines.at(-1)).toBe(footer(`Total: 2 | ${PANEL_HELP}`, 199));
    const periodic = plain(
      render(screen(200, 30, { tab: 'periodic' }), OPTIONS),
    );
    expect(periodic.at(-1)).toMatch(/^ Total: 1 \| \/: Search/);
    const filtered = plain(
      render(screen(200, 30, { filter: 'evil' }), OPTIONS),
    );
    expect(filtered.at(-1)).toMatch(/^ Total: 1 \| /);
  });

  it('drops the least important hints, then the version, when they do not fit', () => {
    const raw = render(screen(120, 20), OPTIONS);
    const last = stripStyles(raw.at(-1) ?? '');
    expect(last).toBe(
      ' Total: 2 | /: Search | S: Sort | s: Apple | r: Refresh | w: Warnings | e: Disable | u: Start | x: Unload | o: Finder'.padEnd(
        119,
      ),
    );
    expect(raw.at(-1)?.startsWith('\u001b[2m')).toBe(true);
    const tiny = plain(render(screen(60, 10), OPTIONS));
    expect(tiny.at(-1)).toBe(
      ' Total: 2 | /: Search | e: Disable | u: Start | x: Unload'.padEnd(59),
    );
  });

  it('names the e key after the selected job state', () => {
    const disabled = plain(render(screen(200, 30, { selected: 1 }), OPTIONS));
    expect(disabled.at(-1)).toContain('| e: Enable | u: Load |');
    expect(disabled.at(-1)).not.toContain('e: Disable');
  });

  it('offers Enter: Detail only without the side panel', () => {
    const narrow = plain(render(screen(116, 20), OPTIONS));
    expect(narrow.at(-1)).toBe(
      ' Total: 2 | Enter: Detail | /: Search | s: Apple | r: Refresh | e: Disable | u: Start | x: Unload | o: Finder'.padEnd(
        115,
      ),
    );
    const wide = plain(render(screen(117, 20), OPTIONS));
    expect(wide.at(-1)).not.toContain('Enter: Detail');
  });

  it('lists the keys of the filter mode', () => {
    const lines = plain(render(screen(120, 20, { mode: 'filter' }), OPTIONS));
    expect(lines.at(-1)).toBe(
      footer('Enter: Apply | Esc: Clear | Backspace: Delete', 119),
    );
  });
});

describe('detailLines', () => {
  it('lists the label, then the sections of the selected entry', () => {
    expect(detailLines(screen(120, 20), 80, '/Users/example')).toEqual([
      'com.example.agent',
      '',
      'Source:',
      '  user-agent',
      '',
      'Triggers:',
      '  at login, every 1 h',
      '',
      'State:',
      '  running (PID 42)',
      '',
      'Program:',
      '  ~/bin/agent --serve',
      '',
      'File:',
      '  ~/Library/LaunchAgents/com.example.agent.plist',
      '',
      'Actions:',
      '  e\u00a0disable  u\u00a0start  x\u00a0unload  o\u00a0Finder  c\u00a0copy',
      '',
    ]);
  });

  it('skips sections without a value', () => {
    const lines = detailLines(screen(120, 20, { selected: 1 }), 80, '');
    expect(lines).toEqual([
      'com.example.evil?[2J',
      '',
      'Source:',
      '  global-daemon',
      '',
      'Triggers:',
      '  keep alive',
      '',
      'State:',
      '  disabled',
      '',
      'Actions:',
      '  e\u00a0enable',
      '',
    ]);
  });

  it('wraps at spaces, commas and slashes without splitting a word', () => {
    const lines = detailLines(screen(120, 20), 20, '/Users/example');
    const at = (title: string): string[] =>
      lines.slice(
        lines.indexOf(title) + 1,
        lines.indexOf('', lines.indexOf(title)),
      );
    expect(at('Actions:')).toEqual([
      '  e\u00a0disable  ',
      '  u\u00a0start  ',
      '  x\u00a0unload  ',
      '  o\u00a0Finder  c\u00a0copy',
    ]);
    expect(at('File:')).toEqual([
      '  ~/Library/',
      '  LaunchAgents/',
      '  com.example.agent.',
      '  plist',
    ]);
    lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(20));
  });

  it('hard-wraps only a token longer than the width', () => {
    const program = `/opt/${'p'.repeat(200)}`;
    const state = loadedWith([{ ...FIRST_ENTRY, label: 'x', program }], []);
    const lines = detailLines(state, 22, '');
    const start = lines.indexOf('Program:') + 1;
    expect(lines[start]).toBe('  /opt/');
    expect(lines[start + 1]).toBe(`  ${'p'.repeat(20)}`);
    expect(lines[start + 2]).toBe(`  ${'p'.repeat(20)}`);
    const end = lines.indexOf('', start);
    expect(
      lines
        .slice(start, end)
        .map((line) => line.slice(2))
        .join(''),
    ).toBe(program);
    lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(22));
  });

  it('never starts a wrapped line with a space', () => {
    const program = 'abcdefghijklm nop';
    const state = loadedWith([{ ...FIRST_ENTRY, label: 'x', program }], []);
    const at = (width: number): string[] => {
      const lines = detailLines(state, width, '');
      const start = lines.indexOf('Program:') + 1;
      return lines.slice(start, lines.indexOf('', start));
    };
    expect(at(15)).toEqual(['  abcdefghijklm', '  nop']);
    expect(at(16)).toEqual(['  abcdefghijklm ', '  nop']);
    [14, 15, 16, 17].forEach((width) =>
      detailLines(state, width, '').forEach((line) => {
        expect(line).not.toMatch(/^ {3}|^ [^ ]/);
        expect(line === '' || line.trim() !== '').toBe(true);
      }),
    );
  });

  it('never emits a line of spaces, even for values that start with spaces', () => {
    const entry = {
      ...FIRST_ENTRY,
      label: '   com.example.spaced',
      program: '   /opt/tool   --flag',
      file: '    ',
    };
    const state = loadedWith([entry], []);
    const lines = detailLines(state, 30, '');
    expect(lines[0]).toBe('com.example.spaced');
    expect(lines).toContain('  /opt/tool   --flag');
    expect(lines).not.toContain('File:');
    [3, 5, 8, 13, 30].forEach((width) =>
      detailLines(state, width, '').forEach((line) => {
        expect(line === '' || line.trim() !== '').toBe(true);
        expect(line).not.toMatch(/^ (?! )|^ {3}/);
      }),
    );
  });

  it('says Nothing selected without a selection', () => {
    expect(detailLines(screen(120, 20, { filter: 'zzz' }), 40, '')).toEqual([
      'Nothing selected',
    ]);
  });
});

/** Every title line carries a value, or is followed by one. */
function expectNoBareTitle(lines: string[]): void {
  lines.forEach((line, index) => {
    if (/^(Source|Triggers|State|Program|File|Actions):$/.test(line.trim())) {
      expect(lines[index + 1] ?? '').toMatch(/^ {2}\S/);
    }
  });
}

const DEEP_FILE = `/Users/example/Library/LaunchAgents/${'deep/'.repeat(60)}x.plist`;
const LONG_LABEL = `com.example.${'long'.repeat(50)}`;
const CUT_CASES: Array<[number, number, Mode, Partial<AutostartEntry>]> = [
  [120, 17, 'list', { file: DEEP_FILE }],
  [120, 20, 'list', { file: DEEP_FILE }],
  [60, 10, 'details', { label: LONG_LABEL }],
];

describe('details that do not fit the height', () => {
  const ACTIONS =
    'e\u00a0disable  u\u00a0start  x\u00a0unload  o\u00a0Finder  c\u00a0copy';
  const agent = (): TuiState => screen(120, 20);

  it('drops the blank lines first', () => {
    expect(detailLines(agent(), 80, '/Users/example', 14)).toEqual([
      'com.example.agent',
      'Source:',
      '  user-agent',
      'Triggers:',
      '  at login, every 1 h',
      'State:',
      '  running (PID 42)',
      'Program:',
      '  ~/bin/agent --serve',
      'File:',
      '  ~/Library/LaunchAgents/com.example.agent.plist',
      'Actions:',
      `  ${ACTIONS}`,
    ]);
  });

  it('then puts each field on one line', () => {
    expect(detailLines(agent(), 80, '/Users/example', 12)).toEqual([
      'com.example.agent',
      'Source:  user-agent',
      'Triggers:  at login, every 1 h',
      'State:  running (PID 42)',
      'Program:  ~/bin/agent --serve',
      'File:  ~/Library/LaunchAgents/com.example.agent.plist',
      `Actions:  ${ACTIONS}`,
    ]);
  });

  it('wraps a long one-line field with an indent', () => {
    const lines = detailLines(agent(), 30, '/Users/example', 12);
    expect(lines.slice(5, 7)).toEqual([
      'File:  ~/Library/LaunchAgents/',
      '  com.example.agent.plist',
    ]);
    lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(30));
  });

  it('keeps Actions visible when even that does not fit', () => {
    expect(detailLines(agent(), 80, '/Users/example', 4)).toEqual([
      'com.example.agent',
      'Source:  user-agent',
      'Triggers:  at login, every 1 h',
      `Actions:  ${ACTIONS}`,
    ]);
    expect(detailLines(agent(), 80, '/Users/example', 1)).toEqual([
      `Actions:  ${ACTIONS}`,
    ]);
  });

  it('ends a field cut to make room with an ellipsis', () => {
    expect(detailLines(agent(), 30, '/Users/example', 8)).toEqual([
      'com.example.agent',
      'Source:  user-agent',
      'Triggers:  at login, every 1 h',
      'State:  running (PID 42)',
      'Program:  ~/bin/agent --serve',
      'File:  ~/Library/LaunchAgents…',
      'Actions:  e\u00a0disable  u\u00a0start  ',
      '  x\u00a0unload  o\u00a0Finder  c\u00a0copy',
    ]);
    const state = loadedWith(
      [
        {
          ...FIRST_ENTRY,
          label: 'x',
          program: 'a'.repeat(30),
          file: undefined,
          triggers: [{ kind: 'load' }],
        },
      ],
      [],
    );
    expect(detailLines(state, 20, '', 8).slice(0, 4)).toEqual([
      'x',
      'Source:  user-agent',
      'Triggers:  at login',
      'State:  runnin…',
    ]);
  });

  it('drops a field left with only its title', () => {
    const state = loadedWith(
      [
        {
          ...FIRST_ENTRY,
          label: 'x',
          program: 'a'.repeat(30),
          file: undefined,
          triggers: [{ kind: 'load' }],
        },
      ],
      [],
    );
    const lines = detailLines(state, 20, '', 10);
    expect(lines).toEqual([
      'x',
      'Source:  user-agent',
      'Triggers:  at login',
      'State:  running ',
      '  (PID 42)',
      'Actions:  ',
      '  e\u00a0disable  ',
      '  u\u00a0start  ',
      '  x\u00a0unload  c\u00a0copy',
    ]);
  });

  const LONG_FILE: AutostartEntry = {
    ...FIRST_ENTRY,
    file: `/Users/example/Library/LaunchAgents/${'deep/'.repeat(30)}com.example.agent.plist`,
  };

  it.each(CUT_CASES)(
    'cuts a long field with an ellipsis at %ix%i (%s)',
    (cols, rows, mode, patch) => {
      const entry = { ...FIRST_ENTRY, ...patch };
      const state = { ...loadedWith([entry], [], cols, rows), mode };
      const lines = plain(render(state, OPTIONS));
      expectExactWidths(lines, cols);
      const body =
        mode === 'list'
          ? lines.slice(6, rows - 2).map((line) => line.slice(73).trimEnd())
          : lines.slice(4, rows - 2).map((line) => line.slice(1).trimEnd());
      const actions = body.findIndex((line) => line.startsWith('Actions:'));
      expect(actions).toBeGreaterThan(0);
      expect(body[actions - 1]).toMatch(/…$/);
      expect(
        body.slice(0, actions).filter((line) => line.endsWith('…')),
      ).toHaveLength(1);
      expectNoBareTitle(body);
    },
  );

  const SIZES: Array<[number, number, Mode]> = [
    [80, 24, 'details'],
    [100, 24, 'details'],
    [120, 24, 'list'],
    [200, 24, 'list'],
  ];

  it.each(SIZES)('shows Actions at %ix%i (%s)', (cols, rows, mode) => {
    const state = { ...loadedWith([LONG_FILE], [], cols, rows), mode };
    const lines = plain(render(state, OPTIONS));
    expectExactWidths(lines, cols);
    const text = lines.slice(0, -2).join('\n');
    expect(text).toContain('Actions:');
    expect(text).toContain('e\u00a0disable');
    expect(text).toContain('com.example.agent');
  });
});

describe('overlays', () => {
  it('keep the tabs and the mode line, and start the body on row 5', () => {
    const lines = plain(render(screen(80, 30, { mode: 'details' }), OPTIONS));
    expectExactWidths(lines, 80);
    expect(lines[0]).toBe(
      ' macos-autostart   1. At startup   2. Periodic '.padEnd(80),
    );
    expect(lines[2]).toMatch(/^ Mode: Details \(Esc to go back\)/);
    expect(lines[3]).toBe(' '.repeat(80));
    expect(lines.slice(4, 7)).toEqual([
      ' com.example.agent'.padEnd(80),
      ''.padEnd(80),
      ' Source:'.padEnd(80),
    ]);
    expect(lines.join('\n')).toContain('   ~/bin/agent --serve');
    expect(lines[28]).toBe('─'.repeat(80));
    expect(lines.at(-1)).toBe(footer('Esc: Back', 79));
  });

  it('says Nothing selected in the details overlay without a selection', () => {
    const state = screen(80, 20, { mode: 'details', filter: 'zzz' });
    const lines = plain(render(state, OPTIONS));
    expectExactWidths(lines, 80);
    expect(lines[4]).toBe(' Nothing selected'.padEnd(80));
  });

  it('draws the warnings overlay with wrapped, sanitized warnings', () => {
    const long = `[cron] ${'x'.repeat(200)}`;
    const state = loadedWith(ENTRIES, [long, 'bad\r\u001b[2Jwarn']);
    const raw = render({ ...state, mode: 'warnings' }, OPTIONS);
    const lines = plain(raw);
    expect(lines).toHaveLength(20);
    expectExactWidths(lines, 120);
    expect(lines[2]).toMatch(/^ Mode: Warnings \(Esc to close\) {3}2 warnings/);
    expect(lines.slice(4, 9)).toEqual([
      ' [cron] '.padEnd(120),
      ` ${'x'.repeat(118)} `,
      ` ${'x'.repeat(82)}`.padEnd(120),
      ' bad??[2Jwarn'.padEnd(120),
      ''.padEnd(120),
    ]);
    expect(lines.at(-1)).toBe(footer('Esc: Back', 119));
    expect(raw.join('')).not.toContain('\r');
  });

  it('shows the full last message above the warnings', () => {
    const status = `Failed: ${'y'.repeat(130)}`;
    const state = { ...loadedWith(ENTRIES, ['[cron] boom']), status };
    const raw = render({ ...state, mode: 'warnings' }, OPTIONS);
    const lines = plain(raw);
    expectExactWidths(lines, 120);
    expect(lines.slice(4, 11)).toEqual([
      ' Last message:'.padEnd(120),
      ' Failed: '.padEnd(120),
      ` ${'y'.repeat(118)} `,
      ` ${'y'.repeat(12)}`.padEnd(120),
      ''.padEnd(120),
      ' [cron] boom'.padEnd(120),
      ''.padEnd(120),
    ]);
    expect(raw[4]).toContain('\u001b[1;35mLast message:\u001b[0m');
  });

  it('shows only the last message when there are no warnings', () => {
    const state = { ...loadedWith(ENTRIES, []), status: 'Done: x\u001b[2J' };
    const lines = plain(render({ ...state, mode: 'warnings' }, OPTIONS));
    expect(lines.slice(4, 8)).toEqual([
      ' Last message:'.padEnd(120),
      ' Done: x?[2J'.padEnd(120),
      ''.padEnd(120),
      ''.padEnd(120),
    ]);
  });

  it('leaves the refresh and no-warnings statuses out of the last message', () => {
    ['Refreshing…', 'No warnings'].forEach((status) => {
      const state = { ...loadedWith(ENTRIES, ['[cron] boom']), status };
      const lines = plain(render({ ...state, mode: 'warnings' }, OPTIONS));
      const body = lines.slice(4, -2).join('\n');
      expect(body).not.toContain('Last message');
      expect(body).not.toContain(status);
      expect(lines[4]).toBe(' [cron] boom'.padEnd(120));
    });
  });
});

describe('untrusted text', () => {
  const C1: AutostartEntry = {
    source: 'user-agent',
    label: 'com.example.c1\u009b2J\u0085x',
    file: '/Users/example/Library/LaunchAgents/c1.plist',
    triggers: [{ kind: 'load' }],
    state: { loaded: true },
  };

  it('replaces C1 controls in the row, the panel and the confirm box', () => {
    const state = loadedWith([C1], [], 200, 30);
    const lines = plain(render(state, OPTIONS));
    expect(lines[7]).toMatch(/^ com\.example\.c1\?2J\?x +user-agent/);
    expect(lines[6]).toContain('│ com.example.c1?2J?x');
    const raw = render(asking(state), OPTIONS);
    expect(plain(raw).join('\n')).toContain(
      "launchctl disable 'gui/501/com.example.c1?2J?x'",
    );
    [...render(state, OPTIONS), ...raw].forEach((line) =>
      expect(line).not.toMatch(/[\u0080-\u009f]/),
    );
  });

  it('never splits an emoji when a label is truncated', () => {
    // The label column is 21 wide at 120 columns: the cut lands inside the emoji.
    const label = `${'a'.repeat(19)}\u{1F600}tail`;
    const state = loadedWith([{ ...C1, label }], []);
    const lines = plain(render(state, OPTIONS));
    expectExactWidths(lines, 120);
    expect(lines[7]).toContain(` ${'a'.repeat(19)}… `);
    lines.forEach((line) => expect(line).not.toMatch(LONE_SURROGATE));
  });

  it('never splits an emoji at the end of a line', () => {
    for (let count = 70; count <= 90; count += 1) {
      const status = `${'x'.repeat(count)}\u{1F600}`;
      const lines = plain(render(screen(120, 20, { status }), OPTIONS));
      expect(lines[2]).toHaveLength(120);
      expect(lines[2]).not.toMatch(LONE_SURROGATE);
    }
  });

  it('never splits an emoji when a detail value wraps', () => {
    const label = `${'a'.repeat(31)}\u{1F600}tail`;
    const lines = detailLines(loadedWith([{ ...C1, label }], []), 32, '');
    expect(lines.slice(0, 2)).toEqual([`${'a'.repeat(31)}`, '\u{1F600}tail']);
    lines.forEach((line) => {
      expect(line.length).toBeLessThanOrEqual(32);
      expect(line).not.toMatch(LONE_SURROGATE);
    });
  });
});
