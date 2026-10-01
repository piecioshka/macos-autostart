import { describe, expect, it } from 'vitest';

import { SOURCES } from '../types.js';
import {
  domainOf,
  isAppleSource,
  isLaunchdSource,
  LAUNCHD_SOURCES,
  launchdDir,
  launchdDomain,
  serviceTarget,
  startsAtBoot,
} from './catalog.js';

describe('source catalog', () => {
  it.each([
    // source, launchd, apple, boot
    ['user-agent', true, false, false],
    ['global-agent', true, false, false],
    ['global-daemon', true, false, true],
    ['system-agent', true, true, false],
    ['system-daemon', true, true, true],
    ['btm', false, false, false],
    ['cron', false, false, true],
    ['periodic', false, false, false],
  ] as const)('%s', (source, launchd, apple, boot) => {
    expect(isLaunchdSource(source)).toBe(launchd);
    expect(isAppleSource(source)).toBe(apple);
    expect(startsAtBoot(source)).toBe(boot);
  });

  it('lists launchd sources in display order', () => {
    expect(LAUNCHD_SOURCES).toEqual(SOURCES.filter(isLaunchdSource));
    expect(LAUNCHD_SOURCES).toHaveLength(5);
  });

  it('puts agents in the gui domain and daemons in the system domain', () => {
    expect(domainOf('user-agent')).toBe('gui');
    expect(domainOf('system-agent')).toBe('gui');
    expect(domainOf('global-daemon')).toBe('system');
    expect(launchdDomain('global-agent', 501)).toBe('gui/501');
    expect(launchdDomain('system-daemon', 501)).toBe('system');
  });

  it('builds launchctl service targets', () => {
    expect(serviceTarget('user-agent', 'com.example.a', 501)).toBe(
      'gui/501/com.example.a',
    );
    expect(serviceTarget('global-daemon', 'com.example.d', 501)).toBe(
      'system/com.example.d',
    );
  });

  it('knows each launchd directory', () => {
    expect(launchdDir('user-agent', '/Users/example')).toBe(
      '/Users/example/Library/LaunchAgents',
    );
    expect(launchdDir('global-agent', '/Users/example')).toBe(
      '/Library/LaunchAgents',
    );
    expect(launchdDir('global-daemon', '/x')).toBe('/Library/LaunchDaemons');
    expect(launchdDir('system-agent', '/x')).toBe(
      '/System/Library/LaunchAgents',
    );
    expect(launchdDir('system-daemon', '/x')).toBe(
      '/System/Library/LaunchDaemons',
    );
  });
});
