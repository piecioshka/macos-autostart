export type Source =
  | 'user-agent'
  | 'global-agent'
  | 'global-daemon'
  | 'system-agent'
  | 'system-daemon'
  | 'btm'
  | 'cron'
  | 'periodic';

/** All sources in display order. */
export const SOURCES: readonly Source[] = [
  'user-agent',
  'global-agent',
  'global-daemon',
  'system-agent',
  'system-daemon',
  'btm',
  'cron',
  'periodic',
];

export type TriggerKind =
  'load' | 'keepalive' | 'interval' | 'calendar' | 'watch' | 'cron';

export interface Trigger {
  kind: TriggerKind;
  detail?: string;
}

export interface EntryState {
  loaded?: boolean;
  pid?: number;
  lastExitCode?: number;
  disabled?: boolean;
}

export interface AutostartEntry {
  source: Source;
  label: string;
  program?: string;
  file?: string;
  triggers: Trigger[];
  state: EntryState;
}

export interface SourceResult {
  entries: AutostartEntry[];
  warnings: string[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  /** Overrides the default timeout for this one call. */
  timeoutMs?: number;
  /** Written to the child's stdin, which is then closed. */
  input?: string;
}

export type Exec = (
  file: string,
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

export interface FsLike {
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  /** Creates a directory with its parents; resolves when it already exists. */
  mkdir(path: string): Promise<void>;
  /** Writes a UTF-8 file; `mode` applies when the file is created. */
  writeFile(path: string, content: string, mode: number): Promise<void>;
}

export interface Context {
  exec: Exec;
  fs: FsLike;
  home: string;
  uid: number;
  /** Where cached command output is stored. */
  cacheDir: string;
  /** How long cached output stays valid; `0` means forever. */
  cacheTtlHours: number;
  /** Current time in milliseconds since the epoch. */
  now: () => number;
}

export interface CollectOptions {
  /** Include Apple's own agents and daemons from /System. Ignored when `sources` is set. */
  includeSystem?: boolean;
  /** Scan only these sources. */
  sources?: readonly Source[];
  /** Ignore the cached `sfltool dumpbtm` output, run it again and cache the fresh result. */
  noCache?: boolean;
}

export interface CollectResult {
  entries: AutostartEntry[];
  warnings: string[];
}
