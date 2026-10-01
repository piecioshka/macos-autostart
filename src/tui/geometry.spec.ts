import { describe, expect, it } from 'vitest';

import {
  geometry,
  HEADER_ROW,
  LIST_TOP,
  listColumns,
  tabLabels,
} from './geometry.js';

const shape = (cols: number) =>
  geometry(cols, 30).columns.map((column) => [
    column.key,
    column.title,
    column.x,
    column.width,
  ]);

describe('geometry', () => {
  it('puts the column headers on row 7 and the list from row 8', () => {
    expect(HEADER_ROW).toBe(7);
    expect(LIST_TOP).toBe(8);
  });

  it('splits a wide screen into list and details panel', () => {
    expect(geometry(120, 30)).toMatchObject({
      tooSmall: false,
      detailsWidth: 48,
      listWidth: 71,
      detailsX: 73,
      listHeight: 21,
    });
    expect(shape(120)).toEqual([
      ['label', 'Label', 2, 21],
      ['source', 'Source', 25, 13],
      ['state', 'State', 40, 20],
      [undefined, 'When', 62, 10],
    ]);
  });

  it('shows the side panel only while the list keeps 70 columns', () => {
    expect(geometry(117, 30)).toMatchObject({
      detailsWidth: 46,
      listWidth: 70,
    });
    expect(geometry(116, 30)).toMatchObject({
      detailsWidth: 0,
      listWidth: 116,
    });
    expect(geometry(99, 30)).toMatchObject({ detailsWidth: 0, listWidth: 99 });
  });

  it('shares the free width 45/25/30 between Label, When and Program', () => {
    expect(shape(99)).toEqual([
      ['label', 'Label', 2, 25],
      ['source', 'Source', 29, 13],
      ['state', 'State', 44, 20],
      [undefined, 'When', 66, 14],
      [undefined, 'Program', 82, 18],
    ]);
    expect(shape(200)).toEqual([
      ['label', 'Label', 2, 34],
      ['source', 'Source', 38, 13],
      ['state', 'State', 53, 20],
      [undefined, 'When', 75, 19],
      [undefined, 'Program', 96, 24],
    ]);
  });

  it('drops Program below 84 and When below 70 list columns', () => {
    const titles = (cols: number) =>
      geometry(cols, 30).columns.map((column) => column.title);
    expect(titles(84)).toEqual(['Label', 'Source', 'State', 'When', 'Program']);
    expect(titles(83)).toEqual(['Label', 'Source', 'State', 'When']);
    expect(titles(70)).toEqual(['Label', 'Source', 'State', 'When']);
    expect(titles(69)).toEqual(['Label', 'Source', 'State']);
    expect(shape(83).at(-1)).toEqual([undefined, 'When', 74, 10]);
    expect(shape(69)[0]).toEqual(['label', 'Label', 2, 31]);
    expect(shape(60)[0]).toEqual(['label', 'Label', 2, 22]);
  });

  it('always fits the columns inside the list, with their minimum widths', () => {
    const minimums: Record<string, number> = {
      Label: 20,
      Source: 13,
      State: 20,
      When: 10,
      Program: 12,
    };
    for (let listWidth = 59; listWidth <= 220; listWidth += 1) {
      const columns = listColumns(listWidth);
      const last = columns.at(-1);
      expect(columns.length).toBeGreaterThanOrEqual(3);
      expect((last?.x ?? 0) + (last?.width ?? 0) - 1).toBeLessThanOrEqual(
        listWidth,
      );
      columns.forEach((column, index) => {
        expect(column.width).toBeGreaterThanOrEqual(
          minimums[column.title] ?? 0,
        );
        const next = columns[index + 1];
        if (next) {
          expect(next.x).toBe(column.x + column.width + 2);
        }
      });
    }
  });

  it('keeps at least 70 list columns next to the side panel', () => {
    for (let cols = 60; cols <= 360; cols += 1) {
      const layout = geometry(cols, 30);
      expect(layout.listWidth).toBeGreaterThanOrEqual(
        layout.detailsWidth > 0 ? 70 : 60,
      );
    }
  });

  it('leaves the list rows between the headers and the separator', () => {
    expect(geometry(80, 20).listHeight).toBe(11);
    expect(geometry(80, 10).listHeight).toBe(1);
  });

  it('flags a screen smaller than 60x10', () => {
    expect(geometry(59, 30).tooSmall).toBe(true);
    expect(geometry(80, 9).tooSmall).toBe(true);
    expect(geometry(60, 10).tooSmall).toBe(false);
  });
});

describe('tabLabels', () => {
  it('places numbered tabs after the badge, one space apart', () => {
    expect(tabLabels()).toEqual([
      { tab: 'startup', x: 20, text: '1. At startup' },
      { tab: 'periodic', x: 36, text: '2. Periodic' },
    ]);
  });
});
