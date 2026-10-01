const ESC = '\u001b';
/** Alternate screen, hidden cursor, mouse clicks (SGR 1006 encoding) and bracketed paste. */
export const ENTER_SEQUENCE = `${ESC}[?1049h${ESC}[?25l${ESC}[?1000h${ESC}[?1006h${ESC}[?2004h`;
export const LEAVE_SEQUENCE = `${ESC}[?2004l${ESC}[?1000l${ESC}[?1006l${ESC}[?25h${ESC}[?1049l`;
const FALLBACK_COLS = 80;
const FALLBACK_ROWS = 24;

export interface TerminalInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
  off(event: 'data', listener: (chunk: string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

export interface TerminalOutput {
  columns?: number;
  rows?: number;
  write(text: string): unknown;
  on(event: 'resize', listener: () => void): unknown;
  off(event: 'resize', listener: () => void): unknown;
}

export interface TerminalHandlers {
  onInput(data: string): void;
  onResize(cols: number, rows: number): void;
}

export interface TerminalSession {
  size(): { cols: number; rows: number };
  draw(lines: string[]): void;
  /** Restores the terminal. Safe to call more than once. */
  close(): void;
}

export function frame(lines: string[]): string {
  return lines
    .map((line, index) => `${ESC}[${index + 1};1H${line}${ESC}[0m`)
    .join('');
}

/** Runs every step even after a failure and returns all errors in order. */
function attemptAll(steps: Array<() => unknown>): unknown[] {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function enter(
  input: TerminalInput,
  output: TerminalOutput,
  onData: (chunk: string) => void,
  onResize: () => void,
): void {
  input.setRawMode?.(true);
  input.setEncoding('utf8');
  input.on('data', onData);
  input.resume();
  output.on('resize', onResize);
  output.write(ENTER_SEQUENCE);
}

export function openTerminal(
  input: TerminalInput,
  output: TerminalOutput,
  handlers: TerminalHandlers,
): TerminalSession {
  let closed = false;
  const size = () => ({
    cols: output.columns || FALLBACK_COLS,
    rows: output.rows || FALLBACK_ROWS,
  });
  const onData = (chunk: string): void => {
    if (!closed) {
      handlers.onInput(chunk);
    }
  };
  const onResize = (): void => {
    if (!closed) {
      const { cols, rows } = size();
      handlers.onResize(cols, rows);
    }
  };
  // Every step is independent, so one failure never skips the others.
  const restore = (): unknown[] =>
    attemptAll([
      () => input.off('data', onData),
      () => output.off('resize', onResize),
      () => output.write(LEAVE_SEQUENCE),
      () => input.setRawMode?.(false),
      () => input.pause(),
    ]);
  try {
    enter(input, output, onData, onResize);
  } catch (error) {
    closed = true;
    restore();
    throw error;
  }
  return {
    size,
    draw: (lines) => {
      if (!closed) {
        output.write(frame(lines));
      }
    },
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      const [firstError] = restore();
      if (firstError !== undefined) {
        throw firstError;
      }
    },
  };
}
