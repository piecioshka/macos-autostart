import { describe, expect, it } from 'vitest';

import { fail, fakeContext, ok } from './__fixtures__/fake-context.js';
import {
  parseLaunchctlList,
  parseLaunchctlPrint,
  parsePrintDisabled,
  readLaunchdState,
  refreshRuntime,
  resolveState,
} from './state.js';
import type { AutostartEntry } from './types.js';

const LIST =
  'PID\tStatus\tLabel\n123\t0\tcom.example.running\n-\t0\tcom.example.idle\n-\t-9\tcom.example.killed\n-\t78\tcom.example.failed\n';

const PRINT_SYSTEM = [
  'system = {',
  '\ttype = system',
  '\tservice stats = {',
  '\t\t     999      - \tcom.example.notaservice',
  '\t}',
  '\tservices = {',
  '\t\t     456      - \tcom.example.daemon',
  '\t\t       0      0 \tcom.example.oneshot',
  '\t\t   84485    -11 \tcom.example.crashed',
  '\t\t       0   (pe) \tcom.example.pending',
  '\t}',
  '\tdisabled services = {',
  '\t\t"com.example.daemon" => enabled',
  '\t}',
  '}',
  '',
].join('\n');

const PRINT_DISABLED =
  'disabled services = {\n\t\t"com.example.on" => enabled\n\t\t"com.example.off" => disabled\n\t\t"com.example.old" => true\n\t\t"com.example.oldon" => false\n\t}\n';

function entry(
  source: AutostartEntry['source'],
  label: string,
  state: AutostartEntry['state'] = {},
): AutostartEntry {
  return { source, label, triggers: [{ kind: 'load' }], state };
}

describe('parseLaunchctlList', () => {
  it('reads PID and last exit status per label', () => {
    const map = parseLaunchctlList(LIST);
    expect(map.get('com.example.running')).toEqual({
      loaded: true,
      pid: 123,
      lastExitCode: 0,
    });
    expect(map.get('com.example.idle')).toEqual({
      loaded: true,
      lastExitCode: 0,
    });
    expect(map.get('com.example.killed')).toEqual({
      loaded: true,
      lastExitCode: -9,
    });
    expect(map.get('com.example.failed')).toEqual({
      loaded: true,
      lastExitCode: 78,
    });
    expect(map.has('Label')).toBe(false);
  });
});

describe('parseLaunchctlPrint', () => {
  it('reads only the services block', () => {
    const map = parseLaunchctlPrint(PRINT_SYSTEM);
    expect([...map.keys()]).toEqual([
      'com.example.daemon',
      'com.example.oneshot',
      'com.example.crashed',
      'com.example.pending',
    ]);
    expect(map.get('com.example.daemon')).toEqual({ loaded: true, pid: 456 });
    expect(map.get('com.example.oneshot')).toEqual({
      loaded: true,
      lastExitCode: 0,
    });
    expect(map.get('com.example.crashed')).toEqual({
      loaded: true,
      pid: 84485,
      lastExitCode: -11,
    });
    expect(map.get('com.example.pending')).toEqual({ loaded: true });
  });

  it('returns an empty map when there is no services block', () => {
    expect(parseLaunchctlPrint('system = {\n}\n').size).toBe(0);
  });
});

describe('parsePrintDisabled', () => {
  it('reads enabled/disabled and the older true/false form', () => {
    const map = parsePrintDisabled(PRINT_DISABLED);
    expect(map.get('com.example.on')).toBe(false);
    expect(map.get('com.example.off')).toBe(true);
    expect(map.get('com.example.old')).toBe(true);
    expect(map.get('com.example.oldon')).toBe(false);
  });
});

describe('readLaunchdState', () => {
  it('runs the four launchctl commands', async () => {
    const ctx = fakeContext({
      uid: 501,
      commands: {
        'launchctl list': ok(LIST),
        'launchctl print system': ok(PRINT_SYSTEM),
        'launchctl print-disabled gui/501': ok(PRINT_DISABLED),
        'launchctl print-disabled system': ok('disabled services = {\n}\n'),
      },
    });
    const { state, warnings } = await readLaunchdState(ctx);
    expect(warnings).toEqual([]);
    expect(state.gui?.get('com.example.running')?.pid).toBe(123);
    expect(state.system?.get('com.example.daemon')?.pid).toBe(456);
    expect(state.guiDisabled?.get('com.example.off')).toBe(true);
    expect(state.systemDisabled?.size).toBe(0);
  });

  it('turns a failed command into a warning and leaves that map undefined', async () => {
    const ctx = fakeContext({
      uid: 501,
      commands: {
        'launchctl list': ok(LIST),
        'launchctl print system': fail('Operation not permitted\n', 1),
        'launchctl print-disabled gui/501': ok(''),
        'launchctl print-disabled system': ok(''),
      },
    });
    const { state, warnings } = await readLaunchdState(ctx);
    expect(state.system).toBeUndefined();
    expect(warnings).toEqual([
      '[launchctl] print system: Operation not permitted',
    ]);
  });
});

describe('refreshRuntime', () => {
  const agent = (s: AutostartEntry['state']) =>
    entry('user-agent', 'com.example.running', s);

  it('runs only launchctl list and print system, updates runtime fields and keeps disabled', async () => {
    const calls: string[] = [];
    const ctx = fakeContext({
      calls,
      commands: {
        'launchctl list': ok(LIST),
        'launchctl print system': ok(PRINT_SYSTEM),
      },
    });
    const { entries, warnings } = await refreshRuntime(ctx, [
      agent({ loaded: false, disabled: true }),
    ]);
    expect(calls.toSorted()).toEqual([
      'launchctl list',
      'launchctl print system',
    ]);
    expect(warnings).toEqual([]);
    expect(entries[0]?.state).toEqual({
      loaded: true,
      pid: 123,
      lastExitCode: 0,
      disabled: true,
    });
  });

  it('marks a job missing from the domain as not loaded', async () => {
    const ctx = fakeContext({
      commands: {
        'launchctl list': ok('PID\tStatus\tLabel\n'),
        'launchctl print system': ok(PRINT_SYSTEM),
      },
    });
    const { entries } = await refreshRuntime(ctx, [
      agent({ loaded: true, pid: 9 }),
    ]);
    expect(entries[0]?.state).toMatchObject({ loaded: false, pid: undefined });
  });

  it('leaves entries alone when their domain could not be read, and non-launchd entries always', async () => {
    const ctx = fakeContext({
      commands: {
        'launchctl list': fail('boom\n', 1),
        'launchctl print system': ok(PRINT_SYSTEM),
      },
    });
    const cron: AutostartEntry = {
      source: 'cron',
      label: 'x',
      triggers: [{ kind: 'cron', detail: '* * * * *' }],
      state: {},
    };
    const input = [agent({ loaded: true, pid: 9 }), cron];
    const { entries, warnings } = await refreshRuntime(ctx, input);
    expect(entries).toEqual(input);
    expect(warnings).toEqual(['[launchctl] list: boom']);
  });
});

describe('resolveState', () => {
  const state = {
    gui: parseLaunchctlList(LIST),
    system: parseLaunchctlPrint(PRINT_SYSTEM),
    guiDisabled: parsePrintDisabled(PRINT_DISABLED),
    systemDisabled: new Map<string, boolean>(),
  };
  const resolve = (
    item: AutostartEntry,
    launchd: typeof state | object = state,
  ) => resolveState([item], { launchd, btmDisabled: new Set() })[0]?.state;

  it('looks agents up in the gui domain', () => {
    expect(resolve(entry('user-agent', 'com.example.running'))).toEqual({
      loaded: true,
      pid: 123,
      lastExitCode: 0,
    });
  });

  it('looks daemons up in the system domain', () => {
    expect(resolve(entry('global-daemon', 'com.example.daemon'))).toEqual({
      loaded: true,
      pid: 456,
    });
  });

  it('marks a label missing from the domain as not loaded', () => {
    expect(resolve(entry('global-agent', 'com.example.nowhere'))).toEqual({
      loaded: false,
    });
  });

  it('lets print-disabled override the plist Disabled key both ways', () => {
    expect(
      resolve(entry('user-agent', 'com.example.on', { disabled: true }))
        ?.disabled,
    ).toBe(false);
    expect(resolve(entry('user-agent', 'com.example.off'))?.disabled).toBe(
      true,
    );
  });

  it('leaves the state alone when launchctl was not available', () => {
    expect(
      resolve(
        entry('user-agent', 'com.example.running', { disabled: true }),
        {},
      ),
    ).toEqual({ disabled: true });
  });

  it('lets BTM disallowed win over print-disabled enabled', () => {
    const [resolved] = resolveState(
      [
        {
          ...entry('user-agent', 'com.example.on'),
          file: '/Users/example/Library/LaunchAgents/com.example.on.plist',
        },
      ],
      {
        launchd: state,
        btmDisabled: new Set([
          '/Users/example/Library/LaunchAgents/com.example.on.plist',
        ]),
      },
    );
    expect(resolved?.state.disabled).toBe(true);
  });

  it('leaves non-launchd entries alone', () => {
    const cron: AutostartEntry = {
      source: 'cron',
      label: 'x',
      file: '/etc/crontab',
      triggers: [{ kind: 'cron', detail: '* * * * *' }],
      state: {},
    };
    expect(
      resolveState([cron], {
        launchd: state,
        btmDisabled: new Set(['/etc/crontab']),
      }),
    ).toEqual([cron]);
  });
});
