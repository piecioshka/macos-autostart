import { basename, join } from 'node:path';

import { ifExists } from '../exec.js';
import type {
  AutostartEntry,
  Context,
  SourceResult,
  Trigger,
} from '../types.js';

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\s*=/;
const SCHEDULE_FIELDS = 5;
const PERIODS: readonly string[] = ['daily', 'weekly', 'monthly'];

function isJobLine(line: string): boolean {
  return line !== '' && !line.startsWith('#') && !ENV_ASSIGNMENT.test(line);
}

function parseCronLine(
  line: string,
  file: string | undefined,
  hasUserField: boolean,
): AutostartEntry | null {
  const fields = line.split(/\s+/);
  const scheduleLength = line.startsWith('@') ? 1 : SCHEDULE_FIELDS;
  const command = fields
    .slice(scheduleLength + (hasUserField ? 1 : 0))
    .join(' ');
  if (command === '') {
    return null;
  }
  const schedule = fields.slice(0, scheduleLength).join(' ');
  const trigger: Trigger =
    schedule === '@reboot'
      ? { kind: 'load' }
      : { kind: 'cron', detail: schedule };
  const [executable = command] = command.split(' ');
  return {
    source: 'cron',
    label: basename(executable),
    program: command,
    file,
    triggers: [trigger],
    state: {},
  };
}

export function parseCrontab(
  text: string,
  file: string | undefined,
  hasUserField: boolean,
): AutostartEntry[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(isJobLine)
    .flatMap((line) => {
      const entry = parseCronLine(line, file, hasUserField);
      return entry ? [entry] : [];
    });
}

async function readUserCrontab(ctx: Context): Promise<string> {
  const result = await ctx.exec('crontab', ['-l']);
  if (result.code === 0) {
    return result.stdout;
  }
  if (/no crontab/i.test(result.stderr)) {
    return '';
  }
  throw new Error(result.stderr.trim() || `crontab exited with ${result.code}`);
}

export async function collectCron(ctx: Context): Promise<SourceResult> {
  const user = await readUserCrontab(ctx);
  const system = await ifExists(ctx.fs.readFile('/etc/crontab'), '');
  return {
    entries: [
      ...parseCrontab(user, undefined, false),
      ...parseCrontab(system, '/etc/crontab', true),
    ],
    warnings: [],
  };
}

async function periodEntries(
  ctx: Context,
  period: string,
): Promise<AutostartEntry[]> {
  const dir = `/etc/periodic/${period}`;
  const names = await ifExists(ctx.fs.readdir(dir), []);
  return [...names].sort().map((name): AutostartEntry => ({
    source: 'periodic',
    label: name,
    program: join(dir, name),
    file: join(dir, name),
    triggers: [{ kind: 'calendar', detail: period }],
    state: {},
  }));
}

export async function collectPeriodic(ctx: Context): Promise<SourceResult> {
  const lists = await Promise.all(
    PERIODS.map((period) => periodEntries(ctx, period)),
  );
  return { entries: lists.flat(), warnings: [] };
}
