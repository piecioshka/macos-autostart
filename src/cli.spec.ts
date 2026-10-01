import { describe, expect, it, vi } from 'vitest';

import { chooseMode, main, parseSources, type CliDeps } from './cli.js';
import type { CollectResult } from './types.js';

const RESULT: CollectResult = {
  entries: [
    {
      source: 'user-agent',
      label: 'com.example.agent',
      program: '/usr/local/bin/agent',
      triggers: [{ kind: 'load' }],
      state: { loaded: true, pid: 7 },
    },
  ],
  warnings: ['[cron] boom'],
};

function setup(overrides: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const collect = vi.fn(() => Promise.resolve(RESULT));
  const runTui = vi.fn(() => Promise.resolve(0));
  const exit = vi.fn();
  const deps: CliDeps = {
    collect,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    platform: 'darwin',
    width: 120,
    home: '/Users/example',
    env: {},
    isTty: false,
    runTui,
    exit,
    ...overrides,
  };
  return {
    deps,
    collect,
    runTui,
    exit,
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

describe('parseSources', () => {
  it('expands "launchd" and validates names', () => {
    expect(parseSources(undefined)).toBeUndefined();
    expect(parseSources('cron')).toEqual(['cron']);
    expect(parseSources('launchd')).toEqual([
      'user-agent',
      'global-agent',
      'global-daemon',
      'system-agent',
      'system-daemon',
    ]);
    expect(() => parseSources('nope')).toThrow('unknown source: nope');
  });
});

describe('main', () => {
  it('prints the table, then warnings on stderr', async () => {
    const t = setup();
    expect(await main([], t.deps)).toBe(0);
    expect(t.out()).toContain('macos-autostart v');
    expect(t.out()).toContain('At startup (1)');
    expect(t.out()).toContain('running (PID 7)');
    expect(t.err()).toBe('warning: [cron] boom\n');
    expect(t.collect).toHaveBeenCalledWith({
      includeSystem: false,
      sources: undefined,
      noCache: false,
    });
  });

  it('prints only JSON with --json, warnings included', async () => {
    const t = setup();
    expect(await main(['--json'], t.deps)).toBe(0);
    expect(JSON.parse(t.out())).toEqual(RESULT);
    expect(t.err()).toBe('');
  });

  it('passes --system and --source to collect', async () => {
    const t = setup();
    await main(['--system', '--source', 'btm'], t.deps);
    expect(t.collect).toHaveBeenCalledWith({
      includeSystem: true,
      sources: ['btm'],
      noCache: false,
    });
  });

  it('passes --no-cache to collect', async () => {
    const t = setup();
    await main(['--no-cache', '--json'], t.deps);
    expect(t.collect).toHaveBeenCalledWith({
      includeSystem: false,
      sources: undefined,
      noCache: true,
    });
  });

  it('treats NO_CACHE=true like --no-cache', async () => {
    const t = setup({ env: { NO_CACHE: 'true' } });
    await main(['--json'], t.deps);
    expect(t.collect).toHaveBeenCalledWith(
      expect.objectContaining({ noCache: true }),
    );
  });

  it('lists --no-cache in the help', async () => {
    const t = setup();
    await main(['--help'], t.deps);
    expect(t.out()).toContain(
      '  --no-cache         run sfltool dumpbtm again instead of using its cached output\n',
    );
  });

  it('prints help and version without scanning', async () => {
    const help = setup();
    const version = setup();
    expect(await main(['--help'], help.deps)).toBe(0);
    expect(help.out()).toContain('Usage: macos-autostart [options]');
    expect(await main(['-v'], version.deps)).toBe(0);
    expect(version.out()).toMatch(/^\d+\.\d+\.\d+\n$/);
    expect(help.collect).not.toHaveBeenCalled();
    expect(version.collect).not.toHaveBeenCalled();
  });

  it('prints help and version even with flags that would fail the mode check', async () => {
    const help = setup({ isTty: false });
    expect(await main(['-i', '--help'], help.deps)).toBe(0);
    expect(help.out()).toContain('Usage: macos-autostart [options]');
    expect(help.err()).toBe('');
    const version = setup();
    expect(await main(['--json', '--table', '--version'], version.deps)).toBe(
      0,
    );
    expect(version.out()).toMatch(/^\d+\.\d+\.\d+\n$/);
    expect(version.err()).toBe('');
  });

  it.each([[['--nope']], [['extra']], [['--source', 'nope']], [['--source']]])(
    'exits with 2 and usage for bad arguments %o',
    async (argv) => {
      const t = setup();
      expect(await main(argv, t.deps)).toBe(2);
      expect(t.err()).toContain('Usage: macos-autostart');
      expect(t.collect).not.toHaveBeenCalled();
    },
  );

  it('exits with 1 outside macOS, but help still works there', async () => {
    const linux = setup({ platform: 'linux' });
    expect(await main([], linux.deps)).toBe(1);
    expect(linux.err()).toContain(
      'works only on macOS (current platform: linux)',
    );
    expect(linux.collect).not.toHaveBeenCalled();
    expect(await main(['--help'], setup({ platform: 'linux' }).deps)).toBe(0);
  });
});

describe('chooseMode', () => {
  it.each([
    [{ json: false, table: false, interactive: false }, true, 'tui'],
    [{ json: false, table: false, interactive: false }, false, 'table'],
    [{ json: true, table: false, interactive: false }, true, 'json'],
    [{ json: false, table: true, interactive: false }, true, 'table'],
    [{ json: false, table: false, interactive: true }, true, 'tui'],
  ])('%o, tty %s -> %s', (flags, isTty, mode) => {
    expect(chooseMode(flags, isTty)).toBe(mode);
  });

  it('rejects conflicting flags and -i without a terminal', () => {
    expect(() =>
      chooseMode({ json: true, table: false, interactive: true }, true),
    ).toThrow('choose only one of --json, --table and --interactive');
    expect(() =>
      chooseMode({ json: true, table: true, interactive: false }, true),
    ).toThrow('choose only one');
    expect(() =>
      chooseMode({ json: false, table: false, interactive: true }, false),
    ).toThrow('--interactive needs a terminal');
  });
});

describe('main with a terminal', () => {
  it('opens the TUI by default and passes the options', async () => {
    const t = setup({ isTty: true });
    expect(
      await main(['--system', '--source', 'cron', '--no-cache'], t.deps),
    ).toBe(0);
    expect(t.runTui).toHaveBeenCalledWith({
      collectOptions: { sources: ['cron'], noCache: true },
      showApple: true,
    });
    expect(t.collect).not.toHaveBeenCalled();
    expect(t.out()).toBe('');
  });

  it('passes NO_CACHE=true to the TUI and prints nothing itself', async () => {
    const t = setup({ isTty: true, env: { NO_CACHE: 'true' } });
    expect(await main([], t.deps)).toBe(0);
    expect(t.runTui).toHaveBeenCalledWith({
      collectOptions: { sources: undefined, noCache: true },
      showApple: false,
    });
    expect(t.out()).toBe('');
    expect(t.err()).toBe('');
  });

  it('prints the table with --table and JSON with --json', async () => {
    const table = setup({ isTty: true });
    await main(['--table'], table.deps);
    expect(table.out()).toContain('At startup (1)');
    expect(table.runTui).not.toHaveBeenCalled();
    const json = setup({ isTty: true });
    await main(['--json'], json.deps);
    expect(JSON.parse(json.out())).toEqual(RESULT);
  });

  it('exits 2 for -i without a terminal and for conflicting flags', async () => {
    const noTty = setup({ isTty: false });
    expect(await main(['-i'], noTty.deps)).toBe(2);
    expect(noTty.err()).toContain('--interactive needs a terminal');
    expect(await main(['--json', '-i'], setup({ isTty: true }).deps)).toBe(2);
  });

  it('refuses to open the TUI outside macOS', async () => {
    const t = setup({ isTty: true, platform: 'linux' });
    expect(await main([], t.deps)).toBe(1);
    expect(t.runTui).not.toHaveBeenCalled();
  });

  it('returns the TUI exit code', async () => {
    const t = setup({
      isTty: true,
      runTui: vi.fn(() => Promise.resolve(143)),
    });
    expect(await main([], t.deps)).toBe(143);
    expect(t.exit).toHaveBeenCalledWith(143);
  });

  it('exits the process after the TUI so a pending child cannot keep it alive', async () => {
    const t = setup({ isTty: true });
    expect(await main([], t.deps)).toBe(0);
    expect(t.exit).toHaveBeenCalledTimes(1);
    expect(t.exit).toHaveBeenCalledWith(0);
  });

  it('never exits the process in table or JSON mode', async () => {
    const table = setup({ isTty: true });
    expect(await main(['--table'], table.deps)).toBe(0);
    const json = setup();
    expect(await main(['--json'], json.deps)).toBe(0);
    const piped = setup();
    expect(await main([], piped.deps)).toBe(0);
    expect(table.exit).not.toHaveBeenCalled();
    expect(json.exit).not.toHaveBeenCalled();
    expect(piped.exit).not.toHaveBeenCalled();
  });
});
