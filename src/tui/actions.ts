import {
  isLaunchdSource,
  launchdDomain,
  serviceTarget,
  type LaunchdSource,
} from '../sources/catalog.js';
import type { AutostartEntry, Context, ExecResult } from '../types.js';

export type ActionKind = 'toggle' | 'start' | 'stop' | 'reveal' | 'copy';

export interface Command {
  file: string;
  args: string[];
  input?: string;
}

export interface PlannedAction {
  kind: ActionKind;
  command: Command;
  /** What the action does; shown in the confirmation dialog and the status bar. */
  description: string;
  needsConfirm: boolean;
  /** For launchctl: the same command with sudo, offered when launchctl refuses. */
  sudoHint?: string;
}

export type ActionPlan =
  { ok: true; action: PlannedAction } | { ok: false; reason: string };

export const LAUNCHCTL_KINDS: ReadonlySet<ActionKind> = new Set([
  'toggle',
  'start',
  'stop',
]);

const BARE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** POSIX-quotes a value so pasting it into a shell cannot run anything extra. */
export function shellQuote(value: string): string {
  if (BARE_WORD.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function commandText(command: Command): string {
  return [command.file, ...command.args].map(shellQuote).join(' ');
}

function launchctl(
  kind: ActionKind,
  args: string[],
  description: string,
): ActionPlan {
  const command: Command = { file: 'launchctl', args };
  return {
    ok: true,
    action: {
      kind,
      command,
      description,
      needsConfirm: true,
      sudoHint: `sudo ${commandText(command)}`,
    },
  };
}

function planToggle(entry: AutostartEntry, target: string): ActionPlan {
  if (entry.state.disabled) {
    return launchctl(
      'toggle',
      ['enable', target],
      'Enable again; it starts at the next login, boot or load',
    );
  }
  return launchctl(
    'toggle',
    ['disable', target],
    'Disable permanently until enabled again',
  );
}

/** `u`: a loaded job is started now; an unloaded one is loaded from its plist (and starts as the plist says). */
function planStart(
  entry: AutostartEntry,
  source: LaunchdSource,
  target: string,
  uid: number,
): ActionPlan {
  if (entry.state.disabled) {
    return { ok: false, reason: 'Enable the job first (e)' };
  }
  if (entry.state.loaded === true) {
    return launchctl('start', ['kickstart', target], 'Start now');
  }
  if (entry.file === undefined) {
    return { ok: false, reason: 'No plist to load' };
  }
  return launchctl(
    'start',
    ['bootstrap', launchdDomain(source, uid), entry.file],
    'Load the plist; it starts as the plist says',
  );
}

function planStop(entry: AutostartEntry, target: string): ActionPlan {
  if (entry.state.loaded === true) {
    return launchctl(
      'stop',
      ['bootout', target],
      'Stop and unload until the next login or boot',
    );
  }
  return { ok: false, reason: 'Only a loaded launchd job can be unloaded' };
}

function planReveal(entry: AutostartEntry): ActionPlan {
  if (entry.file === undefined) {
    return { ok: false, reason: 'No file to show' };
  }
  return {
    ok: true,
    action: {
      kind: 'reveal',
      command: { file: 'open', args: ['-R', entry.file] },
      description: 'Show in Finder',
      needsConfirm: false,
    },
  };
}

function planCopy(entry: AutostartEntry): ActionPlan {
  const text = entry.file ?? entry.program;
  if (text === undefined) {
    return { ok: false, reason: 'Nothing to copy' };
  }
  return {
    ok: true,
    action: {
      kind: 'copy',
      command: { file: 'pbcopy', args: [], input: text },
      description: `Copy ${text}`,
      needsConfirm: false,
    },
  };
}

export function planAction(
  entry: AutostartEntry,
  kind: ActionKind,
  uid: number,
): ActionPlan {
  if (kind === 'reveal') {
    return planReveal(entry);
  }
  if (kind === 'copy') {
    return planCopy(entry);
  }
  if (!isLaunchdSource(entry.source)) {
    return { ok: false, reason: 'Only launchd jobs support this action' };
  }
  const target = serviceTarget(entry.source, entry.label, uid);
  if (kind === 'toggle') {
    return planToggle(entry, target);
  }
  return kind === 'start'
    ? planStart(entry, entry.source, target, uid)
    : planStop(entry, target);
}

function failure(result: ExecResult): string {
  return result.stderr.trim() || `exit ${result.code}`;
}

async function runUnsafe(ctx: Context, action: PlannedAction): Promise<string> {
  const { command } = action;
  const result = await ctx.exec(command.file, command.args, {
    input: command.input,
  });
  if (result.code === 0) {
    return `Done: ${action.description}`;
  }
  if (action.sudoHint === undefined) {
    return `Failed: ${failure(result)}`;
  }
  const copied = await ctx.exec('pbcopy', [], { input: action.sudoHint });
  const where =
    copied.code === 0 ? 'copied to clipboard' : 'run it in a terminal';
  return `Failed: ${failure(result)}. Needs root? ${action.sudoHint} (${where})`;
}

/** Runs a planned action and returns the status bar message; never rejects. */
export async function runAction(
  ctx: Context,
  action: PlannedAction,
): Promise<string> {
  try {
    return await runUnsafe(ctx, action);
  } catch (error) {
    return `Failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
