import { defaultContext, errorMessage } from '../exec.js';
import type { CollectOptions } from '../types.js';
import { createCoordinator, type Coordinator } from './coordinator.js';
import { createInputDecoder } from './input.js';
import {
  initialState,
  update,
  type Effect,
  type TuiEvent,
  type TuiState,
} from './model.js';
import { createSystem, type TuiSystem } from './system.js';
import {
  openTerminal,
  type TerminalInput,
  type TerminalOutput,
  type TerminalSession,
} from './terminal.js';
import { render } from './view.js';

type Signal = 'SIGTERM' | 'SIGHUP' | 'SIGINT';

export interface TuiDeps {
  system: TuiSystem;
  input: TerminalInput;
  output: TerminalOutput;
  collectOptions: CollectOptions;
  showApple: boolean;
  useColor: boolean;
  version: string;
  refreshIntervalMs: number;
  /** Calls `fn` every `ms` milliseconds; returns a function that stops it. */
  every(ms: number, fn: () => void): () => void;
  signals: {
    on(signal: Signal, listener: () => void): unknown;
    off(signal: Signal, listener: () => void): unknown;
  };
  /** Runs `fn` soon (setImmediate); tests run it synchronously. */
  schedule(fn: () => void): void;
  stderr(text: string): void;
}

export interface TuiLaunch {
  collectOptions: CollectOptions;
  showApple: boolean;
}

const EXIT_ERROR = 1;
/** Exit codes follow the shell convention 128 + signal number. */
const SIGNAL_EXIT_CODES: ReadonlyArray<[Signal, number]> = [
  ['SIGTERM', 143],
  ['SIGHUP', 129],
  ['SIGINT', 130],
];
const REFRESH_INTERVAL_MS = 5000;
const PREFIX = 'macos-autostart: ';

class TuiApp {
  private state: TuiState;
  private session?: TerminalSession;
  private stopTimer: () => void = () => undefined;
  private resolveExit: (code: number) => void = () => undefined;
  private readonly coordinator: Coordinator;
  private drawQueued = false;
  private finished = false;
  private readonly signalListeners = SIGNAL_EXIT_CODES.map(
    ([signal, code]): [Signal, () => void] => [signal, () => this.finish(code)],
  );

  constructor(private readonly deps: TuiDeps) {
    this.state = initialState({
      uid: deps.system.uid,
      cols: 80,
      rows: 24,
      showApple: deps.showApple,
    });
    this.coordinator = createCoordinator(deps.system, deps.collectOptions, {
      dispatch: (event) => this.dispatch(event),
      entries: () => this.state.entries,
      fail: (error) => this.fail(error),
      finished: () => this.finished,
    });
  }

  start(): Promise<number> {
    return new Promise((resolve) => {
      this.resolveExit = resolve;
      try {
        this.open();
        this.draw();
        this.coordinator.run({ type: 'collect' });
      } catch (error) {
        this.fail(error);
      }
    });
  }

  private open(): void {
    const decode = createInputDecoder();
    this.session = openTerminal(this.deps.input, this.deps.output, {
      onInput: (data) => decode(data).forEach((event) => this.dispatch(event)),
      onResize: (cols, rows) => this.dispatch({ type: 'resize', cols, rows }),
    });
    const { cols, rows } = this.session.size();
    this.state = { ...this.state, cols, rows };
    this.signalListeners.forEach(([signal, listener]) =>
      this.deps.signals.on(signal, listener),
    );
    this.stopTimer = this.deps.every(this.deps.refreshIntervalMs, () =>
      this.dispatch({ type: 'tick' }),
    );
  }

  private dispatch(event: TuiEvent): void {
    if (this.finished) {
      return;
    }
    try {
      const { state, effects } = update(this.state, event);
      this.state = state;
      this.queueDraw();
      effects.forEach((effect) => this.run(effect));
    } catch (error) {
      this.fail(error);
    }
  }

  private run(effect: Effect): void {
    if (this.finished) {
      return;
    }
    if (effect.type === 'quit') {
      this.finish(0);
      return;
    }
    this.coordinator.run(effect);
  }

  private queueDraw(): void {
    if (this.drawQueued) {
      return;
    }
    this.drawQueued = true;
    this.deps.schedule(() => {
      this.drawQueued = false;
      // Runs outside dispatch (setImmediate), so it needs its own guard.
      try {
        this.draw();
      } catch (error) {
        this.fail(error);
      }
    });
  }

  private draw(): void {
    if (this.finished) {
      return;
    }
    const { useColor, version, system } = this.deps;
    this.session?.draw(
      render(this.state, { useColor, version, home: system.home }),
    );
  }

  private fail(error: unknown): void {
    this.finish(EXIT_ERROR, `${PREFIX}${errorMessage(error)}\n`);
  }

  /** Restores the terminal; returns a stderr message when that fails. */
  private closeSession(): string {
    try {
      this.session?.close();
      return '';
    } catch (error) {
      return `${PREFIX}could not restore the terminal: ${errorMessage(error)}\n`;
    }
  }

  private finish(code: number, message = ''): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    // The terminal first: closeSession never throws, so nothing below can skip it.
    const text = message + this.closeSession();
    try {
      this.stopTimer();
      this.signalListeners.forEach(([signal, listener]) =>
        this.deps.signals.off(signal, listener),
      );
      if (text) {
        this.deps.stderr(text);
      }
    } finally {
      this.resolveExit(code);
    }
  }
}

export function runTui(deps: TuiDeps): Promise<number> {
  return new TuiApp(deps).start();
}

export function createTuiDeps(launch: TuiLaunch, version: string): TuiDeps {
  return {
    system: createSystem(defaultContext()),
    input: process.stdin,
    output: process.stdout,
    collectOptions: launch.collectOptions,
    showApple: launch.showApple,
    useColor: (process.env.NO_COLOR ?? '') === '',
    version,
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    every: (ms, fn) => {
      const handle = setInterval(fn, ms);
      return () => clearInterval(handle);
    },
    signals: {
      on: (signal, listener) => process.on(signal, listener),
      off: (signal, listener) => process.off(signal, listener),
    },
    schedule: (fn) => {
      setImmediate(fn);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
  };
}
