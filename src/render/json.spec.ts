import { describe, expect, it } from 'vitest';

import { renderJson } from './json.js';

describe('renderJson', () => {
  it('prints indented JSON with a trailing newline', () => {
    const result = { entries: [], warnings: ['[cron] boom'] };
    const text = renderJson(result);
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(result);
    expect(text).toContain('\n  "warnings"');
  });
});
