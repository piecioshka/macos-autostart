const LAST_CONTROL_CHAR = 0x1f;
const DELETE_CHAR = 0x7f;
/** C1 controls end at U+009F; U+009B alone is a CSI in some terminals. */
const LAST_C1_CHAR = 0x9f;
const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;

export function shortenHome(text: string, home: string): string {
  return home === '' ? text : text.replaceAll(`${home}/`, '~/');
}

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_FIRST && code <= HIGH_SURROGATE_LAST;
}

/**
 * The first `max` UTF-16 code units of `text`, one fewer when the cut would
 * split a surrogate pair (an emoji), so no lone surrogate is ever printed.
 */
export function cutUnits(text: string, max: number): string {
  if (max <= 0) {
    return '';
  }
  if (text.length <= max) {
    return text;
  }
  return isHighSurrogate(text.charCodeAt(max - 1))
    ? text.slice(0, max - 1)
    : text.slice(0, max);
}

/** Fits `text` into `max` code units; a cut text ends with `…` and keeps exactly `max` units. */
export function truncate(text: string, max: number): string {
  if (max <= 0) {
    return '';
  }
  return text.length <= max ? text : `${cutUnits(text, max - 1)}…`.padEnd(max);
}

/** Labels and arguments come from third-party plists: an ESC or CR must not rewrite the terminal. */
export function sanitize(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0);
      const control =
        code <= LAST_CONTROL_CHAR ||
        (code >= DELETE_CHAR && code <= LAST_C1_CHAR);
      return control ? '?' : char;
    })
    .join('');
}
