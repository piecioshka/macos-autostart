export type KeyName =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'pageup'
  | 'pagedown'
  | 'home'
  | 'end'
  | 'enter'
  | 'escape'
  | 'tab'
  | 'backtab'
  | 'backspace'
  | 'ctrl-c';

export type Key = { name: KeyName } | { name: 'char'; char: string };

export interface Mouse {
  kind: 'press' | 'wheelup' | 'wheeldown';
  /** 1-based column. */
  x: number;
  /** 1-based row. */
  y: number;
}

export type InputEvent =
  { type: 'key'; key: Key } | { type: 'mouse'; mouse: Mouse };

interface Parsed {
  events: InputEvent[];
  next: number;
  /** Set when the parsed sequence starts a bracketed paste. */
  paste?: boolean;
}

const ESC = '\u001b';
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;
const WHEEL_BIT = 64;
const MOTION_BIT = 32;
const BUTTON_MASK = 4;
const WHEEL_KINDS = new Map<number, Mouse['kind']>([
  [0, 'wheelup'],
  [1, 'wheeldown'],
]);
const PASTE_START = '[200~';
const PASTE_START_MARKER = `${ESC}${PASTE_START}`;
const PASTE_END = `${ESC}[201~`;
/**
 * A chunk ending in `ESC [ 2` or more of the paste start marker waits for the next chunk.
 * A chunk ending in exactly `ESC [` is not held: Alt+[ sends it, and holding it would glue
 * the next key to it as a CSI sequence. A lone ESC is the Escape key.
 */
const MIN_HELD_START = 3;
const CTRL_C = '\u0003';
const X10_PREFIX = '[M';
const X10_LENGTH = 3;
const X10_OFFSET = 32;

/** Patterns match what follows the ESC character (lint forbids control characters in regexes). */
const SGR_MOUSE = /\[<(\d+);(\d+);(\d+)([Mm])/y;
const CSI = /\[([0-9;]*)([A-Za-z~])/y;
const SS3 = /O([A-Za-z])/y;

const FINAL_KEYS = new Map<string, KeyName>([
  ['A', 'up'],
  ['B', 'down'],
  ['C', 'right'],
  ['D', 'left'],
  ['H', 'home'],
  ['F', 'end'],
  ['Z', 'backtab'],
]);

const TILDE_KEYS = new Map<string, KeyName>([
  ['1', 'home'],
  ['7', 'home'],
  ['4', 'end'],
  ['8', 'end'],
  ['5', 'pageup'],
  ['6', 'pagedown'],
]);

const CONTROL_KEYS = new Map<string, KeyName>([
  ['\u0003', 'ctrl-c'],
  ['\r', 'enter'],
  ['\n', 'enter'],
  ['\t', 'tab'],
  ['\u007f', 'backspace'],
  ['\b', 'backspace'],
]);

function keyEvent(name: KeyName): InputEvent {
  return { type: 'key', key: { name } };
}

function matchAt(
  pattern: RegExp,
  data: string,
  index: number,
): RegExpExecArray | null {
  pattern.lastIndex = index;
  return pattern.exec(data);
}

/** `bit` is a power of two; checks it without bitwise operators. */
function hasBit(value: number, bit: number): boolean {
  return Math.floor(value / bit) % 2 === 1;
}

function mouseEvent(
  button: number,
  x: number,
  y: number,
  pressed: boolean,
): InputEvent[] {
  const base = button % BUTTON_MASK;
  if (hasBit(button, WHEEL_BIT)) {
    // Bases 2 and 3 are the horizontal wheel (left/right), which the list ignores.
    const kind = WHEEL_KINDS.get(base);
    return kind ? [{ type: 'mouse', mouse: { kind, x, y } }] : [];
  }
  if (pressed && base === 0 && !hasBit(button, MOTION_BIT)) {
    return [{ type: 'mouse', mouse: { kind: 'press', x, y } }];
  }
  return [];
}

function sgrMouseEvents(match: RegExpExecArray): InputEvent[] {
  const [, rawButton = '0', rawX = '0', rawY = '0', final] = match;
  return mouseEvent(
    Number(rawButton),
    Number(rawX),
    Number(rawY),
    final === 'M',
  );
}

/**
 * X10 report: `ESC [ M` followed by three raw characters (32 + button, 32 + x, 32 + y).
 * A report truncated at the chunk end is dropped together with the rest of the chunk.
 */
function x10MouseEvents(data: string, start: number): Parsed {
  const bytes = data.slice(start, start + X10_LENGTH);
  if (bytes.length < X10_LENGTH) {
    return { events: [], next: data.length };
  }
  const code = (index: number): number => bytes.charCodeAt(index) - X10_OFFSET;
  return {
    events: mouseEvent(code(0), code(1), code(2), true),
    next: start + X10_LENGTH,
  };
}

function csiEvents(match: RegExpExecArray): InputEvent[] {
  const [, params = '', final = ''] = match;
  const [first = ''] = params.split(';');
  const name = final === '~' ? TILDE_KEYS.get(first) : FINAL_KEYS.get(final);
  return name ? [keyEvent(name)] : [];
}

/** `next` is the index right after the matched CSI sequence. */
function parseCsi(data: string, csi: RegExpExecArray, next: number): Parsed {
  if (csi[0] === X10_PREFIX) {
    return x10MouseEvents(data, next);
  }
  if (csi[0] === PASTE_START) {
    return { events: [], next, paste: true };
  }
  return { events: csiEvents(csi), next };
}

function parseEscape(data: string, start: number): Parsed {
  const at = start + 1;
  const mouse = matchAt(SGR_MOUSE, data, at);
  if (mouse) {
    return { events: sgrMouseEvents(mouse), next: at + mouse[0].length };
  }
  const csi = matchAt(CSI, data, at);
  if (csi) {
    return parseCsi(data, csi, at + csi[0].length);
  }
  const ss3 = matchAt(SS3, data, at);
  if (ss3) {
    const name = FINAL_KEYS.get(ss3[1] ?? '');
    return { events: name ? [keyEvent(name)] : [], next: at + ss3[0].length };
  }
  return { events: [keyEvent('escape')], next: at };
}

function parseAt(data: string, index: number): Parsed {
  const char = data[index] ?? '';
  if (char === ESC) {
    return parseEscape(data, index);
  }
  const control = CONTROL_KEYS.get(char);
  if (control) {
    return { events: [keyEvent(control)], next: index + 1 };
  }
  const codePoint = data.codePointAt(index) ?? 0;
  const text = String.fromCodePoint(codePoint);
  const printable = codePoint >= FIRST_PRINTABLE && codePoint !== DELETE;
  return {
    events: printable
      ? [{ type: 'key', key: { name: 'char', char: text } }]
      : [],
    next: index + text.length,
  };
}

/** The longest end of `data` (from `from` on) that is a proper prefix of `marker`. */
function markerTail(data: string, from: number, marker: string): string {
  const longest = Math.min(marker.length - 1, data.length - from);
  for (let size = longest; size > 0; size -= 1) {
    const tail = data.slice(data.length - size);
    if (marker.startsWith(tail)) {
      return tail;
    }
  }
  return '';
}

/** True when the rest of `data` from `index` may be a paste start marker cut by the chunk end. */
function isCutPasteStart(data: string, index: number): boolean {
  const rest = data.slice(index);
  return (
    rest.length >= MIN_HELD_START &&
    rest.length < PASTE_START_MARKER.length &&
    PASTE_START_MARKER.startsWith(rest)
  );
}

/**
 * Decodes a stream of input chunks. Bracketed paste is never turned into keystrokes,
 * even when the paste, or one of its markers, is split across chunks.
 */
class InputDecoder {
  private inPaste = false;
  private pending = '';
  /** The previous chunk ended with a lone ESC, sent as the Escape key. */
  private endedWithEscape = false;

  decode(chunk: string): InputEvent[] {
    const data = this.pending + chunk;
    const events: InputEvent[] = [];
    let index = this.resumedPaste(data);
    this.pending = '';
    this.endedWithEscape = false;
    while (index < data.length) {
      index = this.inPaste
        ? this.skipPaste(data, index, events)
        : this.parseKeys(data, index, events);
    }
    return events;
  }

  /**
   * A paste start marker cut right after its ESC: the ESC already went out as the
   * Escape key, but the paste that follows it is still not typed.
   */
  private resumedPaste(data: string): number {
    if (this.endedWithEscape && data.startsWith(PASTE_START)) {
      this.inPaste = true;
      return PASTE_START.length;
    }
    return 0;
  }

  /**
   * Returns the index after the paste end marker, or the chunk end while the paste goes on.
   * Ctrl+C still gets through, so a paste that never ends cannot lock the view.
   */
  private skipPaste(data: string, index: number, events: InputEvent[]): number {
    const end = data.indexOf(PASTE_END, index);
    const interrupt = data.indexOf(CTRL_C, index);
    if (interrupt !== -1 && (end === -1 || interrupt < end)) {
      events.push(keyEvent('ctrl-c'));
      return interrupt + 1;
    }
    if (end === -1) {
      this.pending = markerTail(data, index, PASTE_END);
      return data.length;
    }
    this.inPaste = false;
    return end + PASTE_END.length;
  }

  private parseKeys(data: string, index: number, events: InputEvent[]): number {
    if (isCutPasteStart(data, index)) {
      this.pending = data.slice(index);
      return data.length;
    }
    const parsed = parseAt(data, index);
    events.push(...parsed.events);
    this.inPaste = parsed.paste === true;
    // Only a lone ESC, not the start of a longer sequence, is the Escape key.
    const lone = data[index] === ESC && parsed.next === index + 1;
    this.endedWithEscape = lone && parsed.next === data.length;
    return parsed.next;
  }
}

/** A decoder that keeps bracketed paste state across the chunks of one terminal session. */
export function createInputDecoder(): (chunk: string) => InputEvent[] {
  const decoder = new InputDecoder();
  return (chunk) => decoder.decode(chunk);
}

/** Turns one chunk of raw terminal input into key and mouse events. Unknown input is dropped. */
export function decodeInput(data: string): InputEvent[] {
  return createInputDecoder()(data);
}
