import { describe, expect, it } from 'vitest';

import { renderTable } from './table.js';
import type { AutostartEntry } from '../types.js';

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

describe('renderTable', () => {
  it('prints two sections with aligned columns and ~ instead of the home directory', () => {
    const lines = renderTable([AGENT, CRON], {
      width: 200,
      home: '/Users/example',
    }).split('\n');
    expect(lines[0]).toBe('At startup (1)');
    expect(lines[1]).toMatch(/^ {2}Label\s+Source\s+When\s+State\s+Program$/);
    expect(lines[2]).toMatch(
      /^ {2}com\.example\.agent\s+user-agent\s+at login\s+running \(PID 42\)\s+~\/bin\/agent --serve$/,
    );
    expect(lines[1]?.indexOf('Source')).toBe(lines[2]?.indexOf('user-agent'));
    expect(lines[1]?.indexOf('Program')).toBe(lines[2]?.indexOf('~/bin'));
    expect(lines[3]).toBe('');
    expect(lines[4]).toBe('Periodic (2)');
    expect(
      lines.some((line) =>
        /backup\.sh\s+cron\s+0 3 \* \* \*\s+-\s+\/usr\/local\/bin\/backup\.sh$/.test(
          line,
        ),
      ),
    ).toBe(true);
  });

  it('prints (none) for an empty section', () => {
    const text = renderTable([CRON], { width: 200, home: '/Users/example' });
    expect(text.startsWith('At startup (0)\n  (none)\n\nPeriodic (1)\n')).toBe(
      true,
    );
  });

  it('truncates the program column to the terminal width', () => {
    const long = { ...CRON, program: `/opt/${'x'.repeat(200)}` };
    const lines = renderTable([long], {
      width: 90,
      home: '/Users/example',
    }).split('\n');
    const row = lines.find((line) => line.includes('backup.sh')) ?? '';
    expect(row.length).toBe(90);
    expect(row.endsWith('…')).toBe(true);
  });

  it('fits long labels, triggers and programs into the terminal width', () => {
    const times = Array.from({ length: 30 }, (_, hour) => `daily ${hour}:00`);
    const long: AutostartEntry = {
      source: 'global-daemon',
      label: `com.example.${'l'.repeat(38)}`,
      program: `/usr/local/libexec/${'p'.repeat(150)} --flag`,
      triggers: [
        { kind: 'load' },
        { kind: 'calendar', detail: times.join('; ').padEnd(300, 'x') },
      ],
      state: { loaded: true, pid: 12345 },
    };
    const text = renderTable([long, AGENT, CRON], {
      width: 120,
      home: '/Users/example',
    });
    const lines = text.split('\n');
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
      120,
    );
    expect(lines.some((line) => line.includes('…'))).toBe(true);
    expect(
      lines.some((line) => line.includes(`com.example.${'l'.repeat(10)}`)),
    ).toBe(true);
  });

  it('shortens the home directory in the When column', () => {
    const watcher: AutostartEntry = {
      ...AGENT,
      triggers: [{ kind: 'watch', detail: '/Users/example/Downloads' }],
    };
    const text = renderTable([watcher], { width: 200, home: '/Users/example' });
    expect(text).toContain('watch ~/Downloads');
    expect(text).not.toContain('/Users/example/Downloads');
  });

  it('replaces control characters in cells with ?', () => {
    const evil: AutostartEntry = {
      ...CRON,
      label: 'com.example.\x1b[2Kevil',
      program: '/bin/sh -c \r\x7fhidden',
    };
    const text = renderTable([evil], { width: 200, home: '/Users/example' });
    expect(text).toContain('com.example.?[2Kevil');
    expect(text).toContain('/bin/sh -c ??hidden');
    expect([...text].some((char) => char < ' ' && char !== '\n')).toBe(false);
  });

  it('keeps a minimum program width on a very narrow terminal', () => {
    const lines = renderTable([AGENT], {
      width: 10,
      home: '/Users/example',
    }).split('\n');
    const row = lines.find((line) => line.includes('com.example.agent')) ?? '';
    expect(row.endsWith('~/bin/agent --serve')).toBe(true);
  });
});
