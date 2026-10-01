import type { PlannedAction } from '../tui/actions.js';
import type { TuiSystem } from '../tui/system.js';
import type {
  AutostartEntry,
  CollectOptions,
  CollectResult,
} from '../types.js';

/** A TuiSystem whose calls resolve only when the test says so. */
export function fakeTuiSystem(uid = 501, home = '/Users/example') {
  const collects: Array<{
    options: CollectOptions;
    resolve: (result: CollectResult) => void;
  }> = [];
  const refreshes: Array<{
    entries: AutostartEntry[];
    resolve: (entries: AutostartEntry[]) => void;
  }> = [];
  const actions: Array<{
    action: PlannedAction;
    resolve: (message: string) => void;
  }> = [];
  const system: TuiSystem = {
    uid,
    home,
    collect: (options) =>
      new Promise((resolve) => collects.push({ options, resolve })),
    refreshRuntime: (entries) =>
      new Promise((resolve) => refreshes.push({ entries, resolve })),
    run: (action) =>
      new Promise((resolve) => actions.push({ action, resolve })),
  };
  return { system, collects, refreshes, actions };
}
