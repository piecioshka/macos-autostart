import { join } from 'node:path';

import { SOURCES, type Source } from '../types.js';

export type LaunchdSource =
  | 'user-agent'
  | 'global-agent'
  | 'global-daemon'
  | 'system-agent'
  | 'system-daemon';

/** `gui/<uid>` holds agents, `system` holds daemons. */
export type LaunchdDomain = 'gui' | 'system';

interface LaunchdInfo {
  kind: 'launchd';
  domain: LaunchdDomain;
  dir: (home: string) => string;
  /** Apple's own jobs from /System, hidden by default. */
  apple: boolean;
  /** A load trigger means "at boot" instead of "at login". */
  boot: boolean;
}

interface OtherInfo {
  kind: 'btm' | 'cron' | 'periodic';
  apple: false;
  boot: boolean;
}

type SourceInfo<S extends Source> = S extends LaunchdSource
  ? LaunchdInfo
  : OtherInfo;

/** Every fact about a source, one row each. */
const CATALOG: { [S in Source]: SourceInfo<S> } = {
  'user-agent': {
    kind: 'launchd',
    domain: 'gui',
    dir: (home) => join(home, 'Library/LaunchAgents'),
    apple: false,
    boot: false,
  },
  'global-agent': {
    kind: 'launchd',
    domain: 'gui',
    dir: () => '/Library/LaunchAgents',
    apple: false,
    boot: false,
  },
  'global-daemon': {
    kind: 'launchd',
    domain: 'system',
    dir: () => '/Library/LaunchDaemons',
    apple: false,
    boot: true,
  },
  'system-agent': {
    kind: 'launchd',
    domain: 'gui',
    dir: () => '/System/Library/LaunchAgents',
    apple: true,
    boot: false,
  },
  'system-daemon': {
    kind: 'launchd',
    domain: 'system',
    dir: () => '/System/Library/LaunchDaemons',
    apple: true,
    boot: true,
  },
  btm: { kind: 'btm', apple: false, boot: false },
  cron: { kind: 'cron', apple: false, boot: true },
  periodic: { kind: 'periodic', apple: false, boot: false },
};

export function isLaunchdSource(source: Source): source is LaunchdSource {
  return CATALOG[source].kind === 'launchd';
}

export const LAUNCHD_SOURCES: readonly LaunchdSource[] =
  SOURCES.filter(isLaunchdSource);

export function isAppleSource(source: Source): boolean {
  return CATALOG[source].apple;
}

export function startsAtBoot(source: Source): boolean {
  return CATALOG[source].boot;
}

export function domainOf(source: LaunchdSource): LaunchdDomain {
  return CATALOG[source].domain;
}

export function launchdDir(source: LaunchdSource, home: string): string {
  return CATALOG[source].dir(home);
}

/** The launchctl domain: `system` for daemons, `gui/<uid>` for agents. */
export function launchdDomain(source: LaunchdSource, uid: number): string {
  return domainOf(source) === 'system' ? 'system' : `gui/${uid}`;
}

/** The launchctl service target, e.g. `gui/501/com.example.agent`. */
export function serviceTarget(
  source: LaunchdSource,
  label: string,
  uid: number,
): string {
  return `${launchdDomain(source, uid)}/${label}`;
}
