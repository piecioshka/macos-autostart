export type Style =
  | 'inverse'
  | 'bold'
  | 'dim'
  | 'red'
  | 'green'
  | 'yellow'
  | 'accent'
  | 'badge'
  | 'activeTab'
  | 'inactiveTab'
  | 'selectedRow';

const ESC = '\u001b';
const CODES: Record<Style, string> = {
  inverse: '7',
  bold: '1',
  dim: '2',
  red: '31',
  green: '32',
  yellow: '33',
  accent: '1;35',
  badge: '48;5;55;97',
  activeTab: '48;5;28;97',
  inactiveTab: '7;2',
  selectedRow: '48;5;55;97',
};
/** What each style becomes without color; styles missing here (inactiveTab too) are dropped. */
const WITHOUT_COLOR = new Map<Style, Style[]>([
  ['inverse', ['inverse']],
  ['bold', ['bold']],
  ['accent', ['bold']],
  ['badge', ['inverse']],
  ['activeTab', ['inverse', 'bold']],
  ['selectedRow', ['inverse']],
]);
const STYLE_SEQUENCE = /^\[[0-9;]*m/;

function withoutColor(styles: Style[]): Style[] {
  const kept = styles.flatMap((style) => WITHOUT_COLOR.get(style) ?? []);
  return [...new Set(kept)];
}

export function paint(
  text: string,
  styles: Style[],
  useColor: boolean,
): string {
  const active = useColor ? styles : withoutColor(styles);
  if (text === '' || active.length === 0) {
    return text;
  }
  return `${ESC}[${active.map((style) => CODES[style]).join(';')}m${text}${ESC}[0m`;
}

/** Removes SGR style sequences; used to measure what the user sees. */
export function stripStyles(text: string): string {
  return text
    .split(ESC)
    .map((part, index) =>
      index === 0 ? part : part.replace(STYLE_SEQUENCE, ''),
    )
    .join('');
}
