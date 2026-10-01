import { describe, expect, it } from 'vitest';

import { cutUnits, sanitize, shortenHome, truncate } from './text.js';

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('shortenHome', () => {
  it('replaces every home prefix with ~', () => {
    expect(
      shortenHome('/Users/example/bin/a /Users/example/x', '/Users/example'),
    ).toBe('~/bin/a ~/x');
  });

  it('leaves text alone when home is empty', () => {
    expect(shortenHome('/Users/example/a', '')).toBe('/Users/example/a');
  });
});

describe('truncate', () => {
  it('keeps short text and cuts long text with an ellipsis', () => {
    expect(truncate('abc', 3)).toBe('abc');
    expect(truncate('abcdef', 4)).toBe('abc…');
  });

  it('returns an empty string for a width of zero or less', () => {
    expect(truncate('abc', 0)).toBe('');
    expect(truncate('abc', -2)).toBe('');
  });

  it('never splits a surrogate pair and keeps the exact width', () => {
    const cut = truncate('ab\u{1F600}cd', 4);
    expect(cut).toBe('ab\u2026 ');
    expect(cut).toHaveLength(4);
    expect(cut).not.toMatch(LONE_SURROGATE);
    expect(truncate('ab\u{1F600}cd', 5)).toBe('ab\u{1F600}\u2026');
  });
});

describe('cutUnits', () => {
  it('cuts to at most max code units on a code point boundary', () => {
    expect(cutUnits('abc', 5)).toBe('abc');
    expect(cutUnits('abc', 2)).toBe('ab');
    expect(cutUnits('a\u{1F600}b', 2)).toBe('a');
    expect(cutUnits('a\u{1F600}b', 3)).toBe('a\u{1F600}');
    expect(cutUnits('abc', -1)).toBe('');
  });
});

describe('sanitize', () => {
  it('replaces control characters with ?', () => {
    expect(sanitize('a\u001b[2Kb\rc\u007f')).toBe('a?[2Kb?c?');
  });

  it('replaces C1 control characters (a single-character CSI) with ?', () => {
    expect(sanitize('a\u009b2Jb\u0085c\u0080d\u009fe\u00a0f')).toBe(
      'a?2Jb?c?d?e\u00a0f',
    );
  });

  it('keeps emoji intact', () => {
    expect(sanitize('ok \u{1F600}')).toBe('ok \u{1F600}');
  });
});
