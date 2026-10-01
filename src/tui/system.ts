import { collect } from '../index.js';
import { refreshRuntime } from '../state.js';
import type {
  AutostartEntry,
  CollectOptions,
  CollectResult,
  Context,
} from '../types.js';
import { runAction, type PlannedAction } from './actions.js';

/** The one seam between the TUI and the machine. */
export interface TuiSystem {
  uid: number;
  home: string;
  collect(options: CollectOptions): Promise<CollectResult>;
  /** Fresh loaded/PID/exit code for launchd entries; never runs sfltool. */
  refreshRuntime(entries: AutostartEntry[]): Promise<AutostartEntry[]>;
  /** Runs a planned action; resolves to the status bar message, never rejects. */
  run(action: PlannedAction): Promise<string>;
}

/** The real adapter: collect, launchctl and actions against `ctx`. */
export function createSystem(ctx: Context): TuiSystem {
  return {
    uid: ctx.uid,
    home: ctx.home,
    collect: (options) => collect(options, ctx),
    refreshRuntime: async (entries) =>
      (await refreshRuntime(ctx, entries)).entries,
    run: (action) => runAction(ctx, action),
  };
}
