import { describe, expect, it } from 'vitest';

import {
  describeEntry,
  formatState,
  formatTrigger,
  groupEntries,
  stateClass,
  whenText,
} from './describe.js';
import type { AutostartEntry } from './types.js';

const AGENT: AutostartEntry = {
  source: 'user-agent',
  label: 'com.example.agent',
  program: '/Users/example/bin/agent --serve',
  triggers: [{ kind: 'load' }, { kind: 'interval', detail: 'every 1 h' }],
  state: { loaded: true, pid: 42 },
};

const CRON: AutostartEntry = {
  source: 'cron',
  label: 'backup.sh',
  program: '/usr/local/bin/backup.sh',
  triggers: [{ kind: 'cron', detail: '0 3 * * *' }],
  state: {},
};

describe('groupEntries', () => {
  it('puts an entry into every group it has a trigger for', () => {
    const groups = groupEntries([AGENT, CRON]);
    expect(groups.atStartup).toEqual([AGENT]);
    expect(groups.periodic).toEqual([AGENT, CRON]);
  });
});

describe('formatTrigger', () => {
  it('says at login for agents and login items, at boot for daemons and cron', () => {
    expect(formatTrigger({ kind: 'load' }, 'user-agent')).toBe('at login');
    expect(formatTrigger({ kind: 'load' }, 'btm')).toBe('at login');
    expect(formatTrigger({ kind: 'load' }, 'global-daemon')).toBe('at boot');
    expect(formatTrigger({ kind: 'load' }, 'cron')).toBe('at boot');
  });

  it('prefers the detail of a load trigger over the source', () => {
    expect(formatTrigger({ kind: 'load', detail: 'at boot' }, 'btm')).toBe(
      'at boot',
    );
  });

  it('describes the other kinds', () => {
    expect(formatTrigger({ kind: 'keepalive' }, 'global-daemon')).toBe(
      'keep alive',
    );
    expect(
      formatTrigger(
        { kind: 'keepalive', detail: 'SuccessfulExit' },
        'global-daemon',
      ),
    ).toBe('keep alive (SuccessfulExit)');
    expect(
      formatTrigger({ kind: 'watch', detail: '/etc/hosts' }, 'global-daemon'),
    ).toBe('watch /etc/hosts');
    expect(
      formatTrigger({ kind: 'interval', detail: 'every 1 h' }, 'user-agent'),
    ).toBe('every 1 h');
    expect(formatTrigger({ kind: 'cron', detail: '0 3 * * *' }, 'cron')).toBe(
      '0 3 * * *',
    );
  });
});

describe('formatState', () => {
  it.each([
    [{ disabled: true, pid: 1 }, 'disabled'],
    [{ loaded: true, pid: 42 }, 'running (PID 42)'],
    [{ loaded: true, lastExitCode: 78 }, 'exited 78'],
    [{ loaded: true, lastExitCode: -9 }, 'killed (signal 9)'],
    [{ loaded: true, lastExitCode: 0 }, 'loaded'],
    [{ loaded: false }, 'not loaded'],
    [{}, '-'],
  ])('%o -> %s', (state, text) => {
    expect(formatState(state)).toBe(text);
  });
});

describe('stateClass', () => {
  it.each([
    [{ disabled: true, pid: 1 }, 'disabled'],
    [{ loaded: true, pid: 42, lastExitCode: 1 }, 'running'],
    [{ loaded: true, lastExitCode: 78 }, 'failed'],
    [{ loaded: true, lastExitCode: -9 }, 'failed'],
    [{ loaded: true, lastExitCode: 0 }, 'loaded'],
    [{ loaded: false }, 'not-loaded'],
    [{}, 'unknown'],
  ] as const)('%o -> %s', (state, expected) => {
    expect(stateClass(state)).toBe(expected);
  });
});

describe('describeEntry', () => {
  const entry: AutostartEntry = {
    source: 'user-agent',
    label: 'com.example.\u001b[2Jevil',
    program: '/Users/example/bin/agent\r--serve',
    file: '/Users/example/Library/LaunchAgents/com.example.plist',
    triggers: [{ kind: 'load' }, { kind: 'interval', detail: 'every 1 h' }],
    state: { loaded: true, pid: 3 },
  };

  it('sanitizes every field and shortens the home directory', () => {
    expect(describeEntry(entry, { home: '/Users/example' })).toEqual({
      label: 'com.example.?[2Jevil',
      source: 'user-agent',
      when: 'at login, every 1 h',
      state: 'running (PID 3)',
      program: '~/bin/agent?--serve',
      file: '~/Library/LaunchAgents/com.example.plist',
    });
  });

  it('keeps only the triggers of the given group', () => {
    expect(describeEntry(entry, { home: '', group: 'periodic' }).when).toBe(
      'every 1 h',
    );
    expect(whenText(entry, 'startup')).toBe('at login');
  });

  it('falls back to the file when there is no program', () => {
    const { program } = describeEntry(
      { ...entry, program: undefined },
      { home: '/Users/example' },
    );
    expect(program).toBe('~/Library/LaunchAgents/com.example.plist');
  });

  it('gives empty file and program when both are missing', () => {
    const text = describeEntry(
      { ...entry, program: undefined, file: undefined },
      { home: '/Users/example' },
    );
    expect(text.file).toBe('');
    expect(text.program).toBe('');
  });
});
