import { describe, expect, it } from 'vitest';

import {
  fakeContext,
  ok,
  type FakeSystem,
} from '../__fixtures__/fake-context.js';
import type { AutostartEntry } from '../types.js';
import { planAction } from './actions.js';
import { createSystem } from './system.js';

const AGENT: AutostartEntry = {
  source: 'user-agent',
  label: 'com.example.agent',
  file: '/Users/example/Library/LaunchAgents/com.example.agent.plist',
  triggers: [{ kind: 'load' }],
  state: { loaded: true, pid: 3 },
};

describe('createSystem', () => {
  it('refreshes runtime state with launchctl only, never sfltool', async () => {
    const system: FakeSystem = {
      calls: [],
      commands: {
        'launchctl list': ok('PID\tStatus\tLabel\n-\t0\tcom.example.agent\n'),
        'launchctl print system': ok('system = {\n}\n'),
      },
    };
    const entries = await createSystem(fakeContext(system)).refreshRuntime([
      AGENT,
    ]);
    expect(system.calls?.toSorted()).toEqual([
      'launchctl list',
      'launchctl print system',
    ]);
    expect(system.calls?.some((call) => call.startsWith('sfltool'))).toBe(
      false,
    );
    expect(entries[0]?.state.pid).toBeUndefined();
    expect(entries[0]?.state.loaded).toBe(true);
  });

  it('runs a planned action and resolves to the status message', async () => {
    const system: FakeSystem = {
      calls: [],
      commands: { 'launchctl disable gui/501/com.example.agent': ok('') },
    };
    const plan = planAction(AGENT, 'toggle', 501);
    const message = plan.ok
      ? await createSystem(fakeContext(system)).run(plan.action)
      : '';
    expect(system.calls).toEqual([
      'launchctl disable gui/501/com.example.agent',
    ]);
    expect(message).toBe('Done: Disable permanently until enabled again');
  });

  it('takes uid and home from the context', () => {
    const system = createSystem(
      fakeContext({ uid: 502, home: '/Users/example2' }),
    );
    expect(system.uid).toBe(502);
    expect(system.home).toBe('/Users/example2');
  });
});
