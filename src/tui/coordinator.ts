import type { AutostartEntry, CollectOptions } from '../types.js';
import { LAUNCHCTL_KINDS, type PlannedAction } from './actions.js';
import type { Effect, TuiEvent } from './model.js';
import type { TuiSystem } from './system.js';

export interface CoordinatorHost {
  dispatch(event: TuiEvent): void;
  /** The entries on screen right now. */
  entries(): AutostartEntry[];
  fail(error: unknown): void;
  /** True once the TUI is closing; no work starts or reports after that. */
  finished(): boolean;
}

export type Work = Exclude<Effect, { type: 'quit' }>;

export interface Coordinator {
  run(work: Work): void;
}

/**
 * Orders the TUI's background work:
 * 1. One collect at a time. A collect request while one is in flight is absorbed, unless a
 *    launchctl action finished after the in-flight collect started; then exactly one more
 *    collect follows it.
 * 2. The first collect passes `noCache: collectOptions.noCache === true`, later ones
 *    `noCache: false`; all pass `includeSystem: true`.
 * 3. One runtime refresh at a time; its result is dropped when a collect finished (`loaded`
 *    dispatched) after the refresh started.
 * 4. An action runs `system.run`, counts as a change when `LAUNCHCTL_KINDS` has its kind, and
 *    dispatches `actionDone` with `refresh` set to that same check.
 * 5. Every rejected promise goes to `host.fail`.
 */
export function createCoordinator(
  system: TuiSystem,
  collectOptions: CollectOptions,
  host: CoordinatorHost,
): Coordinator {
  let refreshing = false;
  let collecting = false;
  /** Set when a collect was asked for that the one in flight cannot serve. */
  let collectAgain = false;
  /** Counts finished launchctl actions. */
  let changes = 0;
  /** `changes` when the collect in flight started. */
  let changesAtLoad = 0;
  let firstLoad = true;
  /** Counts `loaded` dispatches, so a launchctl read older than the last load is dropped. */
  let loadGeneration = 0;

  function report(event: TuiEvent): void {
    if (!host.finished()) {
      host.dispatch(event);
    }
  }

  /** Runs one collect at a time; a request that comes meanwhile is served by the one in flight. */
  async function load(): Promise<void> {
    if (collecting) {
      // A launchctl action finished after this collect started, so its result may predate the change.
      collectAgain ||= changes !== changesAtLoad;
      return;
    }
    collecting = true;
    changesAtLoad = changes;
    try {
      await loadOnce();
    } finally {
      collecting = false;
    }
    if (collectAgain && !host.finished()) {
      collectAgain = false;
      await load();
    }
  }

  async function loadOnce(): Promise<void> {
    const noCache = firstLoad && collectOptions.noCache === true;
    firstLoad = false;
    const result = await system.collect({
      ...collectOptions,
      includeSystem: true,
      noCache,
    });
    loadGeneration += 1;
    report({ type: 'loaded', result });
  }

  async function refreshState(): Promise<void> {
    if (refreshing) {
      return;
    }
    refreshing = true;
    const generation = loadGeneration;
    try {
      const entries = await system.refreshRuntime(host.entries());
      // A load finished meanwhile: its entries are newer than this read.
      if (generation === loadGeneration) {
        report({ type: 'stateRefreshed', entries });
      }
    } finally {
      refreshing = false;
    }
  }

  async function act(action: PlannedAction): Promise<void> {
    const message = await system.run(action);
    const refresh = LAUNCHCTL_KINDS.has(action.kind);
    if (refresh) {
      changes += 1;
    }
    report({ type: 'actionDone', message, refresh });
  }

  function task(work: Work): Promise<void> {
    if (work.type === 'collect') {
      return load();
    }
    return work.type === 'refreshState' ? refreshState() : act(work.action);
  }

  return {
    run(work) {
      if (host.finished()) {
        return;
      }
      task(work).catch((error: unknown) => host.fail(error));
    },
  };
}
