import { describe, expect, it } from 'vitest';

import { fail, fakeContext, ok } from '../__fixtures__/fake-context.js';
import { collectCron, collectPeriodic, parseCrontab } from './cron.js';

const USER_CRONTAB = [
  '# backups',
  'SHELL=/bin/sh',
  'MAILTO = ""',
  '',
  '0 3 * * * /usr/local/bin/backup.sh --full',
  '*/15 * * * *   /usr/local/bin/sync   now',
  '@reboot /usr/local/bin/on-boot',
  '@daily /usr/local/bin/cleanup',
  '* * * * *',
].join('\n');

describe('parseCrontab', () => {
  const entries = parseCrontab(USER_CRONTAB, undefined, false);

  it('skips comments, blank lines, variables and lines without a command', () => {
    expect(entries.map((entry) => entry.label)).toEqual([
      'backup.sh',
      'sync',
      'on-boot',
      'cleanup',
    ]);
  });

  it('keeps the schedule as the trigger detail', () => {
    expect(entries[0]).toEqual({
      source: 'cron',
      label: 'backup.sh',
      program: '/usr/local/bin/backup.sh --full',
      file: undefined,
      triggers: [{ kind: 'cron', detail: '0 3 * * *' }],
      state: {},
    });
    expect(entries[1]?.triggers).toEqual([
      { kind: 'cron', detail: '*/15 * * * *' },
    ]);
    expect(entries[3]?.triggers).toEqual([{ kind: 'cron', detail: '@daily' }]);
  });

  it('turns @reboot into a load trigger', () => {
    expect(entries[2]?.triggers).toEqual([{ kind: 'load' }]);
  });

  it('skips the user column of a system crontab', () => {
    const [entry] = parseCrontab(
      '30 4 * * 6 root /usr/libexec/example weekly\n',
      '/etc/crontab',
      true,
    );
    expect(entry).toMatchObject({
      label: 'example',
      program: '/usr/libexec/example weekly',
      file: '/etc/crontab',
    });
  });
});

describe('collectCron', () => {
  it('reads the user crontab and /etc/crontab', async () => {
    const ctx = fakeContext({
      commands: { 'crontab -l': ok('0 3 * * * /usr/local/bin/backup.sh\n') },
      files: { '/etc/crontab': '0 4 * * * root /usr/libexec/example\n' },
    });
    const result = await collectCron(ctx);
    expect(result.entries.map((entry) => entry.label)).toEqual([
      'backup.sh',
      'example',
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('treats "no crontab" and a missing /etc/crontab as zero entries', async () => {
    const ctx = fakeContext({
      commands: { 'crontab -l': fail('crontab: no crontab for example\n') },
    });
    expect(await collectCron(ctx)).toEqual({ entries: [], warnings: [] });
  });

  it('throws on any other crontab failure', async () => {
    const ctx = fakeContext({
      commands: { 'crontab -l': fail('crontab: permission denied\n') },
    });
    await expect(collectCron(ctx)).rejects.toThrow(
      'crontab: permission denied',
    );
  });
});

describe('collectPeriodic', () => {
  it('lists scripts per period, sorted, and ignores missing directories', async () => {
    const ctx = fakeContext({
      dirs: {
        '/etc/periodic/daily': ['110.clean-tmps', '100.clean-disks'],
        '/etc/periodic/monthly': ['199.rotate'],
      },
    });
    const result = await collectPeriodic(ctx);
    expect(result.entries).toEqual([
      {
        source: 'periodic',
        label: '100.clean-disks',
        program: '/etc/periodic/daily/100.clean-disks',
        file: '/etc/periodic/daily/100.clean-disks',
        triggers: [{ kind: 'calendar', detail: 'daily' }],
        state: {},
      },
      expect.objectContaining({ label: '110.clean-tmps' }),
      expect.objectContaining({
        label: '199.rotate',
        triggers: [{ kind: 'calendar', detail: 'monthly' }],
      }),
    ]);
  });

  it('returns nothing when /etc/periodic does not exist', async () => {
    expect(await collectPeriodic(fakeContext())).toEqual({
      entries: [],
      warnings: [],
    });
  });
});
