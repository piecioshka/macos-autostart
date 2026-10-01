import { describe, expect, it } from 'vitest';

import { fail, fakeContext, ok } from '../__fixtures__/fake-context.js';
import {
  collectLaunchd,
  entryFromPlist,
  formatCalendar,
  formatInterval,
  parseTriggers,
} from './launchd.js';

const plutil = (file: string): string => `plutil -convert json -o - ${file}`;

describe('formatInterval', () => {
  it.each([
    [30, 'every 30 s'],
    [90, 'every 90 s'],
    [300, 'every 5 min'],
    [3600, 'every 1 h'],
    [7200, 'every 2 h'],
    [86400, 'every 1 d'],
    [0, 'every 0 s'],
  ])('%i s -> %s', (seconds, text) => {
    expect(formatInterval(seconds)).toBe(text);
  });
});

describe('formatCalendar', () => {
  it.each([
    [{ Hour: 8, Minute: 51 }, 'daily 08:51'],
    [{ Minute: 0 }, 'every hour at :00'],
    [{ Weekday: 1, Hour: 3, Minute: 15 }, 'Mon 03:15'],
    [{ Weekday: 0, Hour: 3, Minute: 0 }, 'Sun 03:00'],
    [{ Weekday: 7, Hour: 3, Minute: 0 }, 'Sun 03:00'],
    [{ Day: 1, Hour: 0, Minute: 0 }, 'day 1 00:00'],
    [{ Month: 12, Day: 24, Hour: 18, Minute: 0 }, 'month 12 day 24 18:00'],
    [{ Hour: 4 }, 'every minute 04:00-04:59'],
    [{}, 'every minute'],
    [{ Hour: 'x', Minute: 5 }, 'every hour at :05'],
  ])('%o -> %s', (dict, text) => {
    expect(formatCalendar(dict)).toBe(text);
  });
});

describe('parseTriggers', () => {
  it('reads RunAtLoad', () => {
    expect(parseTriggers({ RunAtLoad: true })).toEqual([{ kind: 'load' }]);
    expect(parseTriggers({ RunAtLoad: false })).toEqual([]);
  });

  it('reads KeepAlive as a boolean or a dictionary of conditions', () => {
    expect(parseTriggers({ KeepAlive: true })).toEqual([{ kind: 'keepalive' }]);
    expect(
      parseTriggers({
        KeepAlive: { SuccessfulExit: false, NetworkState: true },
      }),
    ).toEqual([{ kind: 'keepalive', detail: 'SuccessfulExit, NetworkState' }]);
    expect(parseTriggers({ KeepAlive: false })).toEqual([]);
  });

  it('reads StartInterval', () => {
    expect(parseTriggers({ StartInterval: 3600 })).toEqual([
      { kind: 'interval', detail: 'every 1 h' },
    ]);
  });

  it('reads StartCalendarInterval as one dictionary or an array of them', () => {
    expect(
      parseTriggers({ StartCalendarInterval: { Hour: 8, Minute: 0 } }),
    ).toEqual([{ kind: 'calendar', detail: 'daily 08:00' }]);
    expect(
      parseTriggers({
        StartCalendarInterval: [
          { Hour: 8, Minute: 0 },
          { Hour: 20, Minute: 0 },
        ],
      }),
    ).toEqual([{ kind: 'calendar', detail: 'daily 08:00; daily 20:00' }]);
  });

  it('reads WatchPaths, QueueDirectories and StartOnMount', () => {
    expect(
      parseTriggers({
        WatchPaths: ['/etc/hosts', '/etc/resolv.conf'],
        QueueDirectories: ['/var/spool/example'],
        StartOnMount: true,
      }),
    ).toEqual([
      { kind: 'watch', detail: '/etc/hosts, /etc/resolv.conf' },
      { kind: 'watch', detail: '/var/spool/example' },
      { kind: 'watch', detail: 'on volume mount' },
    ]);
  });

  it('keeps several triggers in a fixed order', () => {
    expect(parseTriggers({ StartInterval: 60, RunAtLoad: true })).toEqual([
      { kind: 'load' },
      { kind: 'interval', detail: 'every 1 min' },
    ]);
  });

  it('returns nothing for on-demand jobs', () => {
    expect(
      parseTriggers({ MachServices: { 'com.example.service': true } }),
    ).toEqual([]);
  });
});

describe('entryFromPlist', () => {
  it('builds an entry from Label and ProgramArguments', () => {
    const plist = {
      Label: 'com.example.agent',
      ProgramArguments: ['/usr/local/bin/agent', '--serve'],
      RunAtLoad: true,
    };
    expect(
      entryFromPlist(
        plist,
        '/Library/LaunchAgents/com.example.agent.plist',
        'global-agent',
      ),
    ).toEqual({
      source: 'global-agent',
      label: 'com.example.agent',
      program: '/usr/local/bin/agent --serve',
      file: '/Library/LaunchAgents/com.example.agent.plist',
      triggers: [{ kind: 'load' }],
      state: {},
    });
  });

  it('prefers Program over ProgramArguments[0]', () => {
    const plist = {
      Label: 'x',
      Program: '/bin/real',
      ProgramArguments: ['argv0', '-v'],
      RunAtLoad: true,
    };
    expect(entryFromPlist(plist, '/x.plist', 'global-agent')?.program).toBe(
      '/bin/real -v',
    );
  });

  it('falls back to the file name when Label is missing', () => {
    expect(
      entryFromPlist(
        { RunAtLoad: true },
        '/Library/LaunchAgents/com.example.nolabel.plist',
        'global-agent',
      )?.label,
    ).toBe('com.example.nolabel');
  });

  it('marks Disabled plists', () => {
    expect(
      entryFromPlist(
        { Label: 'x', Disabled: true, RunAtLoad: true },
        '/x.plist',
        'global-agent',
      )?.state,
    ).toEqual({
      disabled: true,
    });
  });

  it('returns null for jobs without a trigger', () => {
    expect(
      entryFromPlist(
        { Label: 'x', MachServices: {} },
        '/x.plist',
        'global-agent',
      ),
    ).toBeNull();
  });
});

describe('collectLaunchd', () => {
  const dir = '/Library/LaunchDaemons';

  it('reads every .plist in the directory, sorted, and skips on-demand jobs', async () => {
    const ctx = fakeContext({
      dirs: {
        [dir]: [
          'com.example.b.plist',
          'README.txt',
          'com.example.a.plist',
          'com.example.ondemand.plist',
        ],
      },
      commands: {
        [plutil(`${dir}/com.example.a.plist`)]: ok(
          JSON.stringify({ Label: 'com.example.a', RunAtLoad: true }),
        ),
        [plutil(`${dir}/com.example.b.plist`)]: ok(
          JSON.stringify({ Label: 'com.example.b', StartInterval: 60 }),
        ),
        [plutil(`${dir}/com.example.ondemand.plist`)]: ok(
          JSON.stringify({ Label: 'com.example.ondemand' }),
        ),
      },
    });
    const result = await collectLaunchd(ctx, 'global-daemon');
    expect(result.entries.map((entry) => entry.label)).toEqual([
      'com.example.a',
      'com.example.b',
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('returns nothing, without a warning, when the directory does not exist', async () => {
    const result = await collectLaunchd(fakeContext(), 'user-agent');
    expect(result).toEqual({ entries: [], warnings: [] });
  });

  it('warns about an unreadable plist and keeps the others', async () => {
    const ctx = fakeContext({
      dirs: { [dir]: ['com.example.locked.plist', 'com.example.ok.plist'] },
      commands: {
        [plutil(`${dir}/com.example.locked.plist`)]: fail(
          `${dir}/com.example.locked.plist: (The file couldn't be opened because you don't have permission to view it.)\n`,
        ),
        [plutil(`${dir}/com.example.ok.plist`)]: ok(
          JSON.stringify({ Label: 'com.example.ok', RunAtLoad: true }),
        ),
      },
    });
    const result = await collectLaunchd(ctx, 'global-daemon');
    expect(result.entries.map((entry) => entry.label)).toEqual([
      'com.example.ok',
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(
      /^\[global-daemon\] com\.example\.locked\.plist: .*permission/,
    );
  });

  it('skips dangling symlinks silently', async () => {
    const ctx = fakeContext({
      dirs: { [dir]: ['com.example.gone.plist'] },
      commands: {
        [plutil(`${dir}/com.example.gone.plist`)]: fail(
          `${dir}/com.example.gone.plist: (The file couldn't be opened because there is no such file.)\n`,
        ),
      },
    });
    expect(await collectLaunchd(ctx, 'global-daemon')).toEqual({
      entries: [],
      warnings: [],
    });
  });

  it('warns when a plist is not a dictionary', async () => {
    const ctx = fakeContext({
      dirs: { [dir]: ['com.example.array.plist'] },
      commands: { [plutil(`${dir}/com.example.array.plist`)]: ok('[1, 2]') },
    });
    const result = await collectLaunchd(ctx, 'global-daemon');
    expect(result.warnings).toEqual([
      '[global-daemon] com.example.array.plist: not a dictionary',
    ]);
  });
});
