import { describe, expect, it } from 'vitest';

import { fakeTuiSystem } from '../__fixtures__/fake-tui-system.js';
import type { AutostartEntry, CollectResult } from '../types.js';
import { planAction, type ActionKind, type PlannedAction } from './actions.js';
import { createCoordinator, type CoordinatorHost } from './coordinator.js';
import type { TuiEvent } from './model.js';

const AGENT: AutostartEntry = {
  source: 'user-agent',
  label: 'com.example.agent',
  file: '/Users/example/Library/LaunchAgents/com.example.agent.plist',
  triggers: [{ kind: 'load' }],
  state: { loaded: true, pid: 3 },
};
const RESULT: CollectResult = { entries: [AGENT], warnings: [] };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function action(kind: ActionKind): PlannedAction {
  const plan = planAction(AGENT, kind, 501);
  if (!plan.ok) {
    throw new Error(plan.reason);
  }
  return plan.action;
}

function setup() {
  const fake = fakeTuiSystem();
  const events: TuiEvent[] = [];
  const failures: unknown[] = [];
  const screen = { entries: [AGENT], finished: false };
  const host: CoordinatorHost = {
    dispatch: (event) => events.push(event),
    entries: () => screen.entries,
    fail: (error) => failures.push(error),
    finished: () => screen.finished,
  };
  const coordinator = createCoordinator(fake.system, { noCache: true }, host);
  return { ...fake, events, failures, screen, coordinator };
}

describe('createCoordinator', () => {
  it('bypasses the cache on the first collect only', async () => {
    const t = setup();
    t.coordinator.run({ type: 'collect' });
    expect(t.collects[0]?.options).toEqual({
      noCache: true,
      includeSystem: true,
    });
    t.collects[0]?.resolve(RESULT);
    await flush();
    t.coordinator.run({ type: 'collect' });
    expect(t.collects[1]?.options).toEqual({
      noCache: false,
      includeSystem: true,
    });
    expect(t.events).toEqual([{ type: 'loaded', result: RESULT }]);
  });

  it('absorbs a collect request while one is in flight', async () => {
    const t = setup();
    t.coordinator.run({ type: 'collect' });
    t.coordinator.run({ type: 'collect' });
    t.coordinator.run({ type: 'collect' });
    expect(t.collects).toHaveLength(1);
    t.collects[0]?.resolve(RESULT);
    await flush();
    expect(t.collects).toHaveLength(1);
    expect(t.events).toEqual([{ type: 'loaded', result: RESULT }]);
  });

  it('collects exactly once more when a launchctl action finished during a collect', async () => {
    const t = setup();
    t.coordinator.run({ type: 'collect' });
    t.coordinator.run({ type: 'run', action: action('toggle') });
    t.actions[0]?.resolve('Done: toggle');
    await flush();
    // The actionDone refresh asks for a collect; twice, to show it stays one.
    t.coordinator.run({ type: 'collect' });
    t.coordinator.run({ type: 'collect' });
    expect(t.collects).toHaveLength(1);
    t.collects[0]?.resolve(RESULT);
    await flush();
    expect(t.collects).toHaveLength(2);
    expect(t.collects[1]?.options).toEqual({
      noCache: false,
      includeSystem: true,
    });
    t.collects[1]?.resolve(RESULT);
    await flush();
    expect(t.collects).toHaveLength(2);
  });

  it('does not collect again for an action that finished before the in-flight collect started', async () => {
    const t = setup();
    t.coordinator.run({ type: 'run', action: action('toggle') });
    t.actions[0]?.resolve('Done: toggle');
    await flush();
    // The follow-up collect starts after the action, so it already sees the change.
    t.coordinator.run({ type: 'collect' });
    expect(t.collects).toHaveLength(1);
    t.coordinator.run({ type: 'collect' });
    t.collects[0]?.resolve(RESULT);
    await flush();
    expect(t.collects).toHaveLength(1);
  });

  it('does not collect again after a copy action finished during a collect', async () => {
    const t = setup();
    t.coordinator.run({ type: 'collect' });
    t.coordinator.run({ type: 'run', action: action('copy') });
    t.actions[0]?.resolve('Done: copy');
    await flush();
    t.coordinator.run({ type: 'collect' });
    t.collects[0]?.resolve(RESULT);
    await flush();
    expect(t.collects).toHaveLength(1);
  });

  it('drops a runtime refresh that a load overtook', async () => {
    const t = setup();
    t.coordinator.run({ type: 'refreshState' });
    t.coordinator.run({ type: 'collect' });
    expect(t.refreshes).toHaveLength(1);
    t.collects[0]?.resolve(RESULT);
    await flush();
    t.refreshes[0]?.resolve([AGENT]);
    await flush();
    expect(t.events.map((event) => event.type)).toEqual(['loaded']);
  });

  it('runs one runtime refresh at a time on the entries on screen', async () => {
    const t = setup();
    const fresh: AutostartEntry = { ...AGENT, state: { loaded: true } };
    t.coordinator.run({ type: 'refreshState' });
    t.coordinator.run({ type: 'refreshState' });
    expect(t.refreshes).toHaveLength(1);
    expect(t.refreshes[0]?.entries).toBe(t.screen.entries);
    t.refreshes[0]?.resolve([fresh]);
    await flush();
    expect(t.events).toEqual([{ type: 'stateRefreshed', entries: [fresh] }]);
    t.coordinator.run({ type: 'refreshState' });
    expect(t.refreshes).toHaveLength(2);
  });

  it('reports an action with refresh set for launchctl kinds only', async () => {
    const t = setup();
    t.coordinator.run({ type: 'run', action: action('toggle') });
    t.coordinator.run({ type: 'run', action: action('copy') });
    expect(t.actions.map((entry) => entry.action.kind)).toEqual([
      'toggle',
      'copy',
    ]);
    t.actions[0]?.resolve('Done: toggle');
    t.actions[1]?.resolve('Done: copy');
    await flush();
    expect(t.events).toEqual([
      { type: 'actionDone', message: 'Done: toggle', refresh: true },
      { type: 'actionDone', message: 'Done: copy', refresh: false },
    ]);
  });

  it('hands rejected work to host.fail', async () => {
    const t = setup();
    const boom = new Error('boom');
    const late = new Error('late');
    t.system.collect = () => Promise.reject(boom);
    t.system.refreshRuntime = () => Promise.reject(late);
    t.coordinator.run({ type: 'collect' });
    t.coordinator.run({ type: 'refreshState' });
    await flush();
    expect(t.failures).toHaveLength(2);
    expect(t.failures).toContain(boom);
    expect(t.failures).toContain(late);
    expect(t.events).toEqual([]);
  });

  it('dispatches nothing and starts nothing once the host finished', async () => {
    const t = setup();
    t.coordinator.run({ type: 'collect' });
    t.coordinator.run({ type: 'refreshState' });
    t.coordinator.run({ type: 'run', action: action('toggle') });
    expect(t.collects).toHaveLength(1);
    expect(t.refreshes).toHaveLength(1);
    expect(t.actions).toHaveLength(1);
    t.screen.finished = true;
    t.collects[0]?.resolve(RESULT);
    t.refreshes[0]?.resolve([AGENT]);
    t.actions[0]?.resolve('Done: toggle');
    await flush();
    t.coordinator.run({ type: 'collect' });
    expect(t.events).toEqual([]);
    expect(t.collects).toHaveLength(1);
  });
});
