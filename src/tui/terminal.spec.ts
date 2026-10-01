import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import {
  ENTER_SEQUENCE,
  frame,
  LEAVE_SEQUENCE,
  openTerminal,
} from './terminal.js';

class FakeInput extends EventEmitter {
  raw: boolean[] = [];
  encoding = '';
  paused = true;
  setRawMode(mode: boolean): void {
    this.raw.push(mode);
  }
  setEncoding(encoding: string): void {
    this.encoding = encoding;
  }
  resume(): void {
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
}

class FakeOutput extends EventEmitter {
  columns = 100;
  rows = 30;
  written: string[] = [];
  write(text: string): void {
    this.written.push(text);
  }
}

function open() {
  const input = new FakeInput();
  const output = new FakeOutput();
  const received: string[] = [];
  const sizes: string[] = [];
  const session = openTerminal(input, output, {
    onInput: (data) => received.push(data),
    onResize: (cols, rows) => sizes.push(`${cols}x${rows}`),
  });
  return { input, output, received, sizes, session };
}

describe('frame', () => {
  it('positions every line and resets styles', () => {
    expect(frame(['ab', 'cd'])).toBe(
      '\u001b[1;1Hab\u001b[0m\u001b[2;1Hcd\u001b[0m',
    );
  });
});

describe('terminal modes', () => {
  it('enables the alternate screen, SGR mouse and bracketed paste, and turns them off on leave', () => {
    expect(ENTER_SEQUENCE).toBe(
      '\u001b[?1049h\u001b[?25l\u001b[?1000h\u001b[?1006h\u001b[?2004h',
    );
    expect(LEAVE_SEQUENCE).toBe(
      '\u001b[?2004l\u001b[?1000l\u001b[?1006l\u001b[?25h\u001b[?1049l',
    );
  });
});

describe('openTerminal', () => {
  it('enters raw mode and the alternate screen, and forwards input and resizes', () => {
    const { input, output, received, sizes, session } = open();
    expect(input.raw).toEqual([true]);
    expect(input.encoding).toBe('utf8');
    expect(input.paused).toBe(false);
    expect(output.written).toEqual([ENTER_SEQUENCE]);
    input.emit('data', 'q');
    output.columns = 90;
    output.emit('resize');
    expect(received).toEqual(['q']);
    expect(sizes).toEqual(['90x30']);
    expect(session.size()).toEqual({ cols: 90, rows: 30 });
  });

  it('draws frames until closed, and restores the terminal exactly once', () => {
    const { input, output, received, session } = open();
    session.draw(['x']);
    session.close();
    session.close();
    session.draw(['y']);
    input.emit('data', 'z');
    expect(output.written).toEqual([
      ENTER_SEQUENCE,
      frame(['x']),
      LEAVE_SEQUENCE,
    ]);
    expect(input.raw).toEqual([true, false]);
    expect(input.paused).toBe(true);
    expect(received).toEqual([]);
  });

  it('falls back to 80x24 when the size is unknown', () => {
    const { output, session } = open();
    output.columns = 0;
    output.rows = 0;
    expect(session.size()).toEqual({ cols: 80, rows: 24 });
  });
});

describe('openTerminal failures', () => {
  it('restores the terminal and rethrows when setup fails', () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    output.write = (text: string): void => {
      output.written.push(text);
      if (text === ENTER_SEQUENCE) {
        throw new Error('EIO');
      }
    };
    expect(() =>
      openTerminal(input, output, { onInput: () => 0, onResize: () => 0 }),
    ).toThrow('EIO');
    expect(input.raw).toEqual([true, false]);
    expect(input.paused).toBe(true);
    expect(input.listenerCount('data')).toBe(0);
    expect(output.listenerCount('resize')).toBe(0);
    expect(output.written).toEqual([ENTER_SEQUENCE, LEAVE_SEQUENCE]);
  });

  it('still writes the leave sequence when raw mode cannot be turned off', () => {
    const { input, output, session } = open();
    input.setRawMode = (mode: boolean): void => {
      if (!mode) {
        throw new Error('EIO');
      }
    };
    expect(() => session.close()).toThrow('EIO');
    expect(output.written).toEqual([ENTER_SEQUENCE, LEAVE_SEQUENCE]);
    expect(input.paused).toBe(true);
    expect(() => session.close()).not.toThrow();
  });

  it('ignores a resize after close', () => {
    const { output, sizes, session } = open();
    session.close();
    output.emit('resize');
    expect(sizes).toEqual([]);
  });
});
