import { describe, expect, it } from 'vitest';

import { createInputDecoder, decodeInput, type InputEvent } from './input.js';

const ESC = '\u001b';
const x10 = (button: number, x: number, y: number): string =>
  `${ESC}[M${String.fromCharCode(button, x, y)}`;
const key = (name: string): InputEvent[] => decodeInput(name);
const named = (keyName: string) => ({ type: 'key', key: { name: keyName } });
const char = (value: string) => ({
  type: 'key',
  key: { name: 'char', char: value },
});

describe('decodeInput', () => {
  it.each([
    [`${ESC}[A`, 'up'],
    [`${ESC}[B`, 'down'],
    [`${ESC}[C`, 'right'],
    [`${ESC}[D`, 'left'],
    [`${ESC}OA`, 'up'],
    [`${ESC}OH`, 'home'],
    [`${ESC}[H`, 'home'],
    [`${ESC}[F`, 'end'],
    [`${ESC}[1~`, 'home'],
    [`${ESC}[4~`, 'end'],
    [`${ESC}[5~`, 'pageup'],
    [`${ESC}[6~`, 'pagedown'],
    [`${ESC}[Z`, 'backtab'],
    [`${ESC}[1;5A`, 'up'],
    ['\r', 'enter'],
    ['\t', 'tab'],
    ['\u007f', 'backspace'],
    ['\u0003', 'ctrl-c'],
    [ESC, 'escape'],
  ])('%j -> %s', (data, name) => {
    expect(key(data)).toEqual([named(name)]);
  });

  it('decodes printable characters, including multi-byte ones', () => {
    expect(decodeInput('qé😀')).toEqual([char('q'), char('é'), char('😀')]);
  });

  it('decodes several events in one chunk', () => {
    expect(decodeInput(`j${ESC}[Bk`)).toEqual([
      char('j'),
      named('down'),
      char('k'),
    ]);
  });

  it('decodes SGR mouse presses and wheel, ignoring release and motion', () => {
    expect(decodeInput(`${ESC}[<0;12;5M`)).toEqual([
      { type: 'mouse', mouse: { kind: 'press', x: 12, y: 5 } },
    ]);
    expect(decodeInput(`${ESC}[<64;3;4M`)).toEqual([
      { type: 'mouse', mouse: { kind: 'wheelup', x: 3, y: 4 } },
    ]);
    expect(decodeInput(`${ESC}[<65;3;4M`)).toEqual([
      { type: 'mouse', mouse: { kind: 'wheeldown', x: 3, y: 4 } },
    ]);
    expect(decodeInput(`${ESC}[<0;12;5m`)).toEqual([]);
    expect(decodeInput(`${ESC}[<32;12;5M`)).toEqual([]);
    expect(decodeInput(`${ESC}[<2;12;5M`)).toEqual([]);
  });

  it('drops horizontal wheel (SGR buttons 66 and 67)', () => {
    expect(decodeInput(`${ESC}[<66;3;4M`)).toEqual([]);
    expect(decodeInput(`${ESC}[<67;3;4M`)).toEqual([]);
    expect(decodeInput(x10(0x62, 0x21, 0x21))).toEqual([]);
  });

  it('decodes X10 mouse reports (ESC [ M + 3 raw bytes)', () => {
    expect(decodeInput(x10(0x20, 0x45, 0x25))).toEqual([
      { type: 'mouse', mouse: { kind: 'press', x: 37, y: 5 } },
    ]);
    expect(decodeInput(x10(0x60, 0x21, 0x21))).toEqual([
      { type: 'mouse', mouse: { kind: 'wheelup', x: 1, y: 1 } },
    ]);
    expect(decodeInput(x10(0x61, 0x21, 0x21))).toEqual([
      { type: 'mouse', mouse: { kind: 'wheeldown', x: 1, y: 1 } },
    ]);
  });

  it('drops X10 releases and never turns the raw bytes into keys', () => {
    expect(decodeInput(x10(0x23, 0x45, 0x25))).toEqual([]);
    expect(decodeInput(x10(0x40, 0x59, 0x51))).toEqual([]);
    expect(decodeInput(`${x10(0x23, 0x45, 0x25)}j`)).toEqual([char('j')]);
  });

  it('drops a truncated X10 report without throwing', () => {
    expect(decodeInput(`${ESC}[M${String.fromCharCode(0x20)}`)).toEqual([]);
    expect(decodeInput(`${ESC}[M`)).toEqual([]);
  });

  it('drops bracketed paste content instead of typing it', () => {
    expect(decodeInput(`${ESC}[200~ey${ESC}[201~`)).toEqual([]);
    expect(decodeInput(`j${ESC}[200~e\ry q${ESC}[201~k`)).toEqual([
      char('j'),
      char('k'),
    ]);
  });

  it('drops the rest of the chunk when a paste is not closed in it', () => {
    expect(decodeInput(`${ESC}[200~ey`)).toEqual([]);
    expect(decodeInput(`${ESC}[201~`)).toEqual([]);
  });

  it('ignores unknown sequences and other control characters', () => {
    expect(decodeInput(`${ESC}[3~`)).toEqual([]);
    expect(decodeInput(`${ESC}[99X`)).toEqual([]);
    expect(decodeInput('\u0001\u0002')).toEqual([]);
  });

  it('treats ESC followed by a plain character as escape and that character', () => {
    expect(decodeInput(`${ESC}x`)).toEqual([named('escape'), char('x')]);
  });
});

describe('createInputDecoder', () => {
  it('drops a paste split across chunks', () => {
    const decode = createInputDecoder();
    expect(decode(`${ESC}[200~ab`)).toEqual([]);
    expect(decode('cdey')).toEqual([]);
    expect(decode(`f${ESC}[201~x`)).toEqual([char('x')]);
    expect(decode('j')).toEqual([char('j')]);
  });

  it('ends a paste when its end marker is split across chunks', () => {
    const decode = createInputDecoder();
    expect(decode(`${ESC}[200~ab${ESC}[20`)).toEqual([]);
    expect(decode(`1~k`)).toEqual([char('k')]);
    const split = createInputDecoder();
    expect(split(`${ESC}[200~ab${ESC}`)).toEqual([]);
    expect(split(`[201~`)).toEqual([]);
    expect(split('q')).toEqual([char('q')]);
  });

  it('starts a paste when its start marker is split across chunks', () => {
    const decode = createInputDecoder();
    expect(decode(`j${ESC}[20`)).toEqual([char('j')]);
    expect(decode(`0~e2${ESC}[201~k`)).toEqual([char('k')]);
  });

  it('holds a trailing ESC [ 2 (or more of a paste marker) until the next chunk', () => {
    const decode = createInputDecoder();
    expect(decode(`j${ESC}[2`)).toEqual([char('j')]);
    expect(decode(`00~e2${ESC}[201~k`)).toEqual([char('k')]);
  });

  it('decodes a chunk ending in exactly ESC [ as escape and [ (Alt+[)', () => {
    const decode = createInputDecoder();
    expect(decode(`${ESC}[`)).toEqual([named('escape'), char('[')]);
    expect(decode('q')).toEqual([char('q')]);
  });

  it('types a paste whose start marker was split after ESC [ (accepted limitation)', () => {
    // Terminals send the start marker in one write; a split this early is not worth
    // eating the next key of every Alt+[ press.
    const decode = createInputDecoder();
    expect(decode(`j${ESC}[`)).toEqual([char('j'), named('escape'), char('[')]);
    expect(decode(`200~e${ESC}[201~k`)).toEqual(
      ['2', '0', '0', '~', 'e', 'k'].map(char),
    );
  });

  it('starts a paste whose marker was split right after ESC', () => {
    const decode = createInputDecoder();
    expect(decode(`j${ESC}`)).toEqual([char('j'), named('escape')]);
    expect(decode(`[200~e2${ESC}[201~k`)).toEqual([char('k')]);
    const plain = createInputDecoder();
    expect(plain(ESC)).toEqual([named('escape')]);
    expect(plain('[2')).toEqual([char('['), char('2')]);
    const arrow = createInputDecoder();
    expect(arrow(`${ESC}[A`)).toEqual([named('up')]);
    expect(arrow('[200~')).toEqual(['[', '2', '0', '0', '~'].map(char));
  });

  it('lets ctrl-c through inside a paste', () => {
    const decode = createInputDecoder();
    expect(decode(`${ESC}[200~ab\u0003cd`)).toEqual([named('ctrl-c')]);
    expect(decode(`ef${ESC}[201~x`)).toEqual([char('x')]);
    expect(decodeInput(`${ESC}[200~\u0003\u0003`)).toEqual([
      named('ctrl-c'),
      named('ctrl-c'),
    ]);
  });

  it('keeps an escape at the end of a chunk a key press', () => {
    const decode = createInputDecoder();
    expect(decode(ESC)).toEqual([named('escape')]);
    expect(decode(`j${ESC}`)).toEqual([char('j'), named('escape')]);
  });

  it('keeps the text of a held prefix that was not a paste marker', () => {
    const decode = createInputDecoder();
    expect(decode(`${ESC}[20`)).toEqual([]);
    expect(decode('~j')).toEqual([char('j')]);
  });
});
