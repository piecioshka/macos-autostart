import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { fakeTuiSystem } from '../__fixtures__/fake-tui-system.js';
import type { AutostartEntry, CollectResult } from '../types.js';
import { runTui, type TuiDeps } from './app.js';
import { ENTER_SEQUENCE, LEAVE_SEQUENCE } from './terminal.js';

class FakeInput extends EventEmitter {
  raw: boolean[] = [];
  setRawMode(mode: boolean): void {
    this.raw.push(mode);
  }
  setEncoding(): void {}
  resume(): void {}
  pause(): void {}
}

/** Fails to leave raw mode, like a terminal that went away. */
class BrokenInput extends FakeInput {
  override setRawMode(mode: boolean): void {
    super.setRawMode(mode);
    if (!mode) {
      throw new Error('EIO: raw mode');
    }
  }
}

class FakeOutput extends EventEmitter {
  columns = 120;
  rows = 20;
  written: string[] = [];
  /** When set, every write but the leave sequence throws, like a closed pipe. */
  failWrites = false;
  write(text: string): void {
    if (this.failWrites && text !== LEAVE_SEQUENCE) {
      throw new Error('EPIPE: frame');
    }
    this.written.push(text);
  }
}

const AGENT: AutostartEntry = {
  source: 'user-agent',
  label: 'com.example.agent',
  file: '/Users/example/Library/LaunchAgents/com.example.agent.plist',
  triggers: [{ kind: 'load' }],
  state: { loaded: true, pid: 3 },
};
const RESULT: CollectResult = { entries: [AGENT], warnings: [] };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(input = new FakeInput()) {
  const fake = fakeTuiSystem();
  const output = new FakeOutput();
  const signals = new EventEmitter();
  const ticks: Array<() => void> = [];
  const stopped: string[] = [];
  const errors: string[] = [];
  const deps: TuiDeps = {
    system: fake.system,
    input,
    output,
    collectOptions: { noCache: true },
    showApple: false,
    useColor: false,
    version: '0.1.0',
    refreshIntervalMs: 5000,
    every: (_ms, fn) => {
      ticks.push(fn);
      return () => stopped.push('timer');
    },
    signals: {
      on: (signal, fn) => signals.on(signal, fn),
      off: (signal, fn) => signals.off(signal, fn),
    },
    schedule: (fn) => fn(),
    stderr: (text) => errors.push(text),
  };
  return { ...fake, deps, input, output, signals, ticks, stopped, errors };
}

type Setup = ReturnType<typeof setup>;

function expectRestored(t: Setup): void {
  expect(t.output.written[0]).toBe(ENTER_SEQUENCE);
  expect(t.output.written.at(-1)).toBe(LEAVE_SEQUENCE);
  expect(t.input.raw).toEqual([true, false]);
  expect(t.stopped).toEqual(['timer']);
  expect(t.signals.listenerCount('SIGTERM')).toBe(0);
  expect(t.signals.listenerCount('SIGHUP')).toBe(0);
  expect(t.signals.listenerCount('SIGINT')).toBe(0);
}

/** Makes the first collect of `t` reject, like a source that throws. */
function failCollect(t: Setup): void {
  t.deps.system.collect = () => Promise.reject(new Error('boom'));
}

/** Opens the TUI and lets its first collect finish. */
async function startLoaded() {
  const t = setup();
  const exit = runTui(t.deps);
  await flush();
  t.collects[0]?.resolve(RESULT);
  await flush();
  return { t, exit };
}

async function type(t: Setup, ...keys: string[]): Promise<void> {
  keys.forEach((key) => t.input.emit('data', key));
  await flush();
}

describe('runTui', () => {
  it('loads with the cache bypass once, runs a confirmed action, refreshes and quits cleanly', async () => {
    const t = setup();
    const exit = runTui(t.deps);
    await flush();
    expect(t.collects.map((call) => call.options)).toEqual([
      { noCache: true, includeSystem: true },
    ]);
    t.collects[0]?.resolve(RESULT);
    await flush();
    await type(t, 'e', 'y');
    expect(t.actions.map((call) => call.action.command)).toEqual([
      {
        file: 'launchctl',
        args: ['disable', 'gui/501/com.example.agent'],
      },
    ]);
    t.actions[0]?.resolve('Done: Disable permanently until enabled again');
    await flush();
    expect(t.collects.map((call) => call.options)).toEqual([
      { noCache: true, includeSystem: true },
      { noCache: false, includeSystem: true },
    ]);
    t.input.emit('data', 'q');
    expect(await exit).toBe(0);
    expectRestored(t);
    expect(t.errors).toEqual([]);
  });

  it('refreshes the entries on screen on tick and draws the result', async () => {
    const { t, exit } = await startLoaded();
    expect(t.output.written.at(-1)).toContain('PID 3');
    t.ticks[0]?.();
    expect(t.refreshes.map((call) => call.entries)).toEqual([[AGENT]]);
    t.refreshes[0]?.resolve([{ ...AGENT, state: { loaded: true } }]);
    await flush();
    expect(t.output.written.at(-1)).not.toContain('PID 3');
    t.input.emit('data', '\u0003');
    expect(await exit).toBe(0);
  });

  it('ignores a paste split across input chunks', async () => {
    const { t, exit } = await startLoaded();
    let exited = false;
    void exit.then(() => {
      exited = true;
    });
    const esc = '\u001b';
    await type(t, `${esc}[200~e`, 'yq', `${esc}[20`, '1~', 'e', 'y');
    await flush();
    expect(exited).toBe(false);
    // Only the e and y typed after the paste reach the view.
    expect(t.actions.map((call) => call.action.kind)).toEqual(['toggle']);
    await type(t, 'q');
    expect(await exit).toBe(0);
  });

  it('restores the terminal and exits 1 when a scheduled draw throws', async () => {
    const t = setup();
    const pending: Array<() => void> = [];
    t.deps.schedule = (fn) => pending.push(fn);
    const exit = runTui(t.deps);
    await flush();
    expect(pending).toHaveLength(0);
    t.collects[0]?.resolve(RESULT);
    await flush();
    expect(pending).toHaveLength(1);
    t.output.failWrites = true;
    pending.forEach((fn) => fn());
    expect(await exit).toBe(1);
    expect(t.errors).toEqual(['macos-autostart: EPIPE: frame\n']);
    expectRestored(t);
  });

  it('restores the terminal and resolves when stopping the timer throws', async () => {
    const t = setup();
    t.deps.every = () => () => {
      throw new Error('timer');
    };
    const exit = runTui(t.deps);
    await flush();
    t.input.emit('data', 'q');
    expect(await exit).toBe(0);
    expect(t.output.written.at(-1)).toBe(LEAVE_SEQUENCE);
    expect(t.input.raw).toEqual([true, false]);
  });

  it('restores the terminal and exits 1 when something throws', async () => {
    const t = setup();
    failCollect(t);
    expect(await runTui(t.deps)).toBe(1);
    expect(t.errors).toEqual(['macos-autostart: boom\n']);
    expectRestored(t);
  });

  it('restores the terminal on SIGTERM and SIGHUP', async () => {
    const term = setup();
    const termExit = runTui(term.deps);
    await flush();
    term.signals.emit('SIGTERM');
    expect(await termExit).toBe(143);
    expectRestored(term);
    const hup = setup();
    const hupExit = runTui(hup.deps);
    await flush();
    hup.signals.emit('SIGHUP');
    expect(await hupExit).toBe(129);
    expectRestored(hup);
  });

  it('restores the terminal on SIGINT', async () => {
    const t = setup();
    const exit = runTui(t.deps);
    await flush();
    expect(t.signals.listenerCount('SIGINT')).toBe(1);
    t.signals.emit('SIGINT');
    expect(await exit).toBe(130);
    expectRestored(t);
  });

  it('still finishes when the terminal cannot be restored', async () => {
    const t = setup(new BrokenInput());
    const exit = runTui(t.deps);
    await flush();
    t.input.emit('data', 'q');
    expect(await exit).toBe(0);
    expect(t.errors).toEqual([
      'macos-autostart: could not restore the terminal: EIO: raw mode\n',
    ]);
    expectRestored(t);
  });

  it('reports both the failure and the restore error', async () => {
    const t = setup(new BrokenInput());
    failCollect(t);
    expect(await runTui(t.deps)).toBe(1);
    expect(t.errors.join('')).toBe(
      'macos-autostart: boom\nmacos-autostart: could not restore the terminal: EIO: raw mode\n',
    );
  });
});
