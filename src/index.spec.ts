import { describe, expect, it } from 'vitest';

import {
  FAKE_NOW,
  fail,
  fakeContext,
  fixture,
  ok,
  type FakeSystem,
} from './__fixtures__/fake-context.js';
import { collect, selectSources } from './index.js';

const AGENT = '/Users/example/Library/LaunchAgents/com.example.agent.plist';
const DAEMON = '/Library/LaunchDaemons/com.example.daemon.plist';
const plutil = (file: string): string => `plutil -convert json -o - ${file}`;

function system(overrides: Partial<FakeSystem> = {}): FakeSystem {
  return {
    uid: 501,
    home: '/Users/example',
    dirs: {
      '/Users/example/Library/LaunchAgents': ['com.example.agent.plist'],
      '/Library/LaunchDaemons': ['com.example.daemon.plist'],
    },
    commands: {
      [plutil(AGENT)]: ok(
        JSON.stringify({
          Label: 'com.example.agent',
          ProgramArguments: ['/usr/local/bin/agent'],
          RunAtLoad: true,
        }),
      ),
      [plutil(DAEMON)]: ok(
        JSON.stringify({
          Label: 'com.example.daemon',
          Program: '/usr/local/bin/exampled',
          KeepAlive: true,
        }),
      ),
      'launchctl list': ok('PID\tStatus\tLabel\n123\t0\tcom.example.agent\n'),
      'launchctl print system': ok(
        'system = {\n\tservices = {\n\t\t     456      - \tcom.example.daemon\n\t}\n}\n',
      ),
      'launchctl print-disabled gui/501': ok('disabled services = {\n}\n'),
      'launchctl print-disabled system': ok('disabled services = {\n}\n'),
      'sfltool dumpbtm': ok(fixture('sfltool-dumpbtm.txt')),
      'crontab -l': ok('0 3 * * * /usr/local/bin/backup.sh\n'),
    },
    calls: [],
    ...overrides,
  };
}

describe('selectSources', () => {
  it('skips Apple system sources by default', () => {
    expect(selectSources({})).toEqual([
      'user-agent',
      'global-agent',
      'global-daemon',
      'btm',
      'cron',
      'periodic',
    ]);
  });

  it('adds them with includeSystem', () => {
    expect(selectSources({ includeSystem: true })).toHaveLength(8);
  });

  it('uses explicit sources as given, in display order', () => {
    expect(
      selectSources({
        sources: ['cron', 'system-daemon'],
        includeSystem: false,
      }),
    ).toEqual(['system-daemon', 'cron']);
  });
});

describe('collect', () => {
  it('merges every source, adds launchctl state and sorts by source then label', async () => {
    const result = await collect({}, fakeContext(system()));
    expect(result.warnings).toEqual([]);
    expect(
      result.entries.map((entry) => `${entry.source}:${entry.label}`),
    ).toEqual([
      'user-agent:com.example.agent',
      'global-daemon:com.example.daemon',
      'btm:com.example.helperagent',
      'btm:com.example.launcher',
      'btm:com.example.suite.daemon',
      'btm:com.example.suite.helper',
      'cron:backup.sh',
    ]);
    expect(result.entries[0]?.state).toEqual({
      loaded: true,
      pid: 123,
      lastExitCode: 0,
    });
  });

  it('marks a launchd job disabled when BTM says the user disallowed it', async () => {
    const result = await collect({}, fakeContext(system()));
    expect(result.entries[1]?.state).toEqual({
      loaded: true,
      pid: 456,
      disabled: true,
    });
  });

  it('turns a failing source into a warning and keeps the rest', async () => {
    const fake = system();
    fake.commands = {
      ...fake.commands,
      'crontab -l': fail('crontab: permission denied\n'),
    };
    const result = await collect({}, fakeContext(fake));
    expect(result.warnings).toEqual(['[cron] crontab: permission denied']);
    expect(result.entries).toHaveLength(6);
  });

  it('warns about sfltool only when BTM entries were requested', async () => {
    const fake = system();
    fake.commands = { ...fake.commands, 'sfltool dumpbtm': ok('garbage\n') };
    const onlyLaunchd = await collect(
      { sources: ['user-agent', 'global-daemon'] },
      fakeContext(fake),
    );
    const withBtm = await collect({ sources: ['btm'] }, fakeContext(fake));
    expect(onlyLaunchd.warnings).toEqual([]);
    expect(onlyLaunchd.entries).toHaveLength(2);
    expect(withBtm.warnings).toEqual([
      '[btm] unrecognized output of sfltool dumpbtm',
    ]);
  });

  it('runs at most 16 plutil processes at once across all launchd directories', async () => {
    const dirs: Record<string, string[]> = {};
    for (const dir of [
      '/Users/example/Library/LaunchAgents',
      '/Library/LaunchAgents',
      '/Library/LaunchDaemons',
      '/System/Library/LaunchAgents',
      '/System/Library/LaunchDaemons',
    ]) {
      dirs[dir] = Array.from(
        { length: 20 },
        (_, index) => `com.example.job${index}.plist`,
      );
    }
    const ctx = fakeContext({ ...system(), dirs });
    let running = 0;
    let peak = 0;
    const exec = ctx.exec;
    ctx.exec = async (file, args) => {
      if (file !== 'plutil') {
        return exec(file, args);
      }
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return ok(JSON.stringify({ Label: 'com.example.job', RunAtLoad: true }));
    };
    await collect(
      {
        sources: [
          'user-agent',
          'global-agent',
          'global-daemon',
          'system-agent',
          'system-daemon',
        ],
      },
      ctx,
    );
    expect(peak).toBe(16);
  });

  it('reads sfltool output from the cache and skips it with noCache', async () => {
    const cacheFile =
      '/Users/example/.cache/macos-autostart/sfltool-dumpbtm.json';
    const entry = JSON.stringify({
      command: 'sfltool dumpbtm',
      savedAt: FAKE_NOW,
      stdout: fixture('sfltool-dumpbtm.txt'),
    });
    const cachedRun = system({ files: { [cacheFile]: entry } });
    const freshRun = system({ files: { [cacheFile]: entry } });
    const cached = await collect({ sources: ['btm'] }, fakeContext(cachedRun));
    await collect({ sources: ['btm'], noCache: true }, fakeContext(freshRun));
    expect(cachedRun.calls).toEqual([]);
    expect(cached.entries).toHaveLength(4);
    expect(freshRun.calls).toEqual(['sfltool dumpbtm']);
  });

  it('warns about a cache it could not save, also when only launchd was requested', async () => {
    const fake = system({ writeError: 'EACCES: permission denied' });
    const result = await collect(
      { sources: ['user-agent'] },
      fakeContext(fake),
    );
    expect(result.warnings).toEqual([
      '[cache] could not save /Users/example/.cache/macos-autostart/sfltool-dumpbtm.json: EACCES: permission denied',
    ]);
    expect(result.entries).toHaveLength(1);
  });

  it('runs only what the selected sources need', async () => {
    const fake = system();
    await collect({ sources: ['cron'] }, fakeContext(fake));
    expect(fake.calls).toEqual(['crontab -l']);
  });
});
