import { describe, expect, it } from 'vitest';

import {
  FAKE_NOW,
  fail,
  fakeContext,
  fixture,
  ok,
  type FakeSystem,
} from '../__fixtures__/fake-context.js';
import type { ExecOptions } from '../types.js';
import {
  SFLTOOL_TIMEOUT_MS,
  btmEntries,
  parseBtm,
  readBtm,
  type BtmItem,
} from './btm.js';

const DUMP = fixture('sfltool-dumpbtm.txt');

describe('parseBtm', () => {
  const items = parseBtm(DUMP);

  it('finds every item in every UID section', () => {
    expect(items).toHaveLength(11);
    expect(items.map((item) => item.uid)).toEqual([
      -2, 501, 501, 501, 501, 501, 501, 501, 501, 501, 502,
    ]);
  });

  it('reads fields, strips the hex code from Type and splits Disposition', () => {
    expect(items[3]).toEqual({
      uid: 501,
      name: 'Example Suite Helper',
      type: 'login item',
      disposition: ['enabled', 'allowed', 'notified'],
      identifier: '4.com.example.suite.helper',
      url: 'Contents/Library/LoginItems/Example%20Suite%20Helper.app',
      executablePath: undefined,
      parent: '2.com.example.suite',
      embedded: false,
    });
  });

  it('marks items with Embedded Item Identifiers and turns (null) into undefined', () => {
    expect(items[2]?.embedded).toBe(true);
    expect(items[6]?.name).toBeUndefined();
    expect(items[6]?.url).toBeUndefined();
  });

  it('returns nothing for empty output', () => {
    expect(parseBtm('')).toEqual([]);
  });
});

describe('btmEntries', () => {
  const { entries, legacyDisabled } = btmEntries(parseBtm(DUMP), 501);
  const byLabel = new Map(entries.map((entry) => [entry.label, entry]));

  it('keeps login items, app agents and daemons and enabled login apps of this user and the system', () => {
    expect([...byLabel.keys()].sort()).toEqual([
      'com.example.helperagent',
      'com.example.launcher',
      'com.example.suite.daemon',
      'com.example.suite.helper',
    ]);
  });

  it('keeps a daemon registered through SMAppService as a boot entry inside its app', () => {
    expect(byLabel.get('com.example.suite.daemon')).toEqual({
      source: 'btm',
      label: 'com.example.suite.daemon',
      program:
        '/Applications/Example Suite.app/Contents/MacOS/ExampleSuiteDaemon',
      file: '/Applications/Example Suite.app/Contents/Library/LaunchDaemons/com.example.suite.daemon.plist',
      triggers: [{ kind: 'load', detail: 'at boot' }],
      state: {},
    });
  });

  it('turns a login app into a load entry pointing at the app', () => {
    expect(byLabel.get('com.example.launcher')).toEqual({
      source: 'btm',
      label: 'com.example.launcher',
      program: '/Applications/Example Launcher.app',
      file: '/Applications/Example Launcher.app',
      triggers: [{ kind: 'load' }],
      state: {},
    });
  });

  it('resolves paths of embedded items against the parent app', () => {
    expect(byLabel.get('com.example.suite.helper')?.program).toBe(
      '/Applications/Example Suite.app/Contents/Library/LoginItems/Example Suite Helper.app',
    );
  });

  it('keeps relative paths when the parent app is unknown and marks disallowed items disabled', () => {
    expect(byLabel.get('com.example.helperagent')).toMatchObject({
      program: 'Contents/MacOS/ExampleHelperAgent',
      file: 'Contents/Library/LaunchAgents/com.example.helperagent.plist',
      state: { disabled: true },
    });
  });

  it('reports only disallowed or disabled legacy plists', () => {
    expect([...legacyDisabled]).toEqual([
      '/Library/LaunchDaemons/com.example.daemon.plist',
    ]);
  });
});

describe('btmEntries with malformed URLs', () => {
  const item = (fields: Partial<BtmItem>): BtmItem => ({
    uid: 501,
    type: 'login item',
    disposition: ['enabled'],
    embedded: false,
    ...fields,
  });
  const items = [
    item({
      type: 'app',
      identifier: '2.com.example.broken',
      url: 'file://host/Applications/Broken.app/',
      embedded: true,
    }),
    item({
      identifier: '4.com.example.percent',
      url: 'Contents/Library/LoginItems/100%.app',
      parent: '2.com.example.broken',
    }),
    item({
      identifier: '8.com.example.remote',
      type: 'agent',
      url: 'file://host/Library/LaunchAgents/com.example.remote.plist',
    }),
    item({
      type: 'legacy agent',
      disposition: ['disabled'],
      url: 'file:///Library/LaunchAgents/100%.plist',
    }),
  ];

  it('keeps the raw text instead of throwing and ignores an app it cannot locate', () => {
    const { entries, legacyDisabled } = btmEntries(items, 501);
    expect(entries.map((entry) => entry.file)).toEqual([
      'Contents/Library/LoginItems/100%.app',
      'file://host/Library/LaunchAgents/com.example.remote.plist',
    ]);
    expect([...legacyDisabled]).toEqual([
      'file:///Library/LaunchAgents/100%.plist',
    ]);
  });
});

describe('readBtm', () => {
  it('parses sfltool output', async () => {
    const ctx = fakeContext({
      uid: 501,
      commands: { 'sfltool dumpbtm': ok(DUMP) },
    });
    expect((await readBtm(ctx)).entries).toHaveLength(4);
  });

  it('gives sfltool 5 minutes, because it may wait for an administrator password', async () => {
    const ctx = fakeContext({
      uid: 501,
      commands: { 'sfltool dumpbtm': ok(DUMP) },
    });
    const seen: (ExecOptions | undefined)[] = [];
    const exec = ctx.exec;
    ctx.exec = (file, args, options) => {
      seen.push(options);
      return exec(file, args, options);
    };
    await readBtm(ctx);
    expect(SFLTOOL_TIMEOUT_MS).toBe(300_000);
    expect(seen).toEqual([{ timeoutMs: SFLTOOL_TIMEOUT_MS }]);
  });

  it('throws with stderr when sfltool fails', async () => {
    const ctx = fakeContext({
      commands: { 'sfltool dumpbtm': fail('sfltool: permission denied\n') },
    });
    await expect(readBtm(ctx)).rejects.toThrow('sfltool: permission denied');
  });

  it('throws when the output format is not recognized', async () => {
    const ctx = fakeContext({
      commands: { 'sfltool dumpbtm': ok('something completely different\n') },
    });
    await expect(readBtm(ctx)).rejects.toThrow(
      'unrecognized output of sfltool dumpbtm',
    );
  });
});

describe('readBtm cache', () => {
  const CACHE = '/Users/example/.cache/macos-autostart/sfltool-dumpbtm.json';
  const HOUR = 3_600_000;
  const cached = (savedAt: number, stdout = DUMP): string =>
    JSON.stringify({ command: 'sfltool dumpbtm', savedAt, stdout });

  function setup(overrides: Partial<FakeSystem> = {}): FakeSystem {
    return {
      uid: 501,
      commands: { 'sfltool dumpbtm': ok(DUMP) },
      calls: [],
      ...overrides,
    };
  }

  function savedEntry(system: FakeSystem): unknown {
    const content = system.files?.[CACHE];
    return content === undefined ? undefined : JSON.parse(content);
  }

  it('saves successful output with the time and mode 0600', async () => {
    const system = setup();
    const result = await readBtm(fakeContext(system));
    expect(result.entries).toHaveLength(4);
    expect(result.warnings).toEqual([]);
    expect(savedEntry(system)).toEqual({
      command: 'sfltool dumpbtm',
      savedAt: FAKE_NOW,
      stdout: DUMP,
    });
    expect(system.modes?.[CACHE]).toBe(0o600);
  });

  it('uses a fresh cache without running sfltool', async () => {
    const system = setup({ files: { [CACHE]: cached(FAKE_NOW - HOUR) } });
    const result = await readBtm(fakeContext(system));
    expect(system.calls).toEqual([]);
    expect(result.entries).toHaveLength(4);
  });

  it('runs sfltool again when the cache expired and saves the new result', async () => {
    const system = setup({
      files: { [CACHE]: cached(FAKE_NOW - 25 * HOUR) },
    });
    await readBtm(fakeContext(system));
    expect(system.calls).toEqual(['sfltool dumpbtm']);
    expect(savedEntry(system)).toMatchObject({ savedAt: FAKE_NOW });
  });

  it('keeps an old entry forever with TTL 0', async () => {
    const system = setup({ files: { [CACHE]: cached(0) }, cacheTtlHours: 0 });
    const result = await readBtm(fakeContext(system));
    expect(system.calls).toEqual([]);
    expect(result.entries).toHaveLength(4);
  });

  it('ignores a fresh cache with noCache and saves the new result', async () => {
    const system = setup({
      files: { [CACHE]: cached(FAKE_NOW - HOUR, 'Records for UID 501\n') },
    });
    const result = await readBtm(fakeContext(system), { noCache: true });
    expect(system.calls).toEqual(['sfltool dumpbtm']);
    expect(result.entries).toHaveLength(4);
    expect(savedEntry(system)).toMatchObject({
      savedAt: FAKE_NOW,
      stdout: DUMP,
    });
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['broken JSON', '{'],
    ['an entry without stdout', JSON.stringify({ savedAt: FAKE_NOW })],
    ['an entry without savedAt', JSON.stringify({ stdout: DUMP })],
    ['output sfltool would not print', cached(FAKE_NOW, 'garbage\n')],
  ])('treats %s in the cache as a miss', async (_name, content) => {
    const system = setup({ files: { [CACHE]: content } });
    const result = await readBtm(fakeContext(system));
    expect(system.calls).toEqual(['sfltool dumpbtm']);
    expect(result.entries).toHaveLength(4);
    expect(savedEntry(system)).toEqual({
      command: 'sfltool dumpbtm',
      savedAt: FAKE_NOW,
      stdout: DUMP,
    });
  });

  it.each([
    ['fails', fail('sfltool: permission denied\n'), 'permission denied'],
    ['prints something else', ok('garbage\n'), 'unrecognized output'],
  ])('never caches a run where sfltool %s', async (_name, answer, message) => {
    const system = setup({ commands: { 'sfltool dumpbtm': answer } });
    await expect(readBtm(fakeContext(system))).rejects.toThrow(message);
    expect(system.files?.[CACHE]).toBeUndefined();
  });

  it('still returns the entries when the cache cannot be written', async () => {
    const system = setup({ writeError: 'EACCES: permission denied' });
    const result = await readBtm(fakeContext(system));
    expect(result.entries).toHaveLength(4);
    expect(result.warnings).toEqual([
      `[cache] could not save ${CACHE}: EACCES: permission denied`,
    ]);
  });
});
