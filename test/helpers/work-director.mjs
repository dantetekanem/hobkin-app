import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinRunner } from '../../src/cli/runner.mjs';
import { WorkDirector } from '../../src/cli/work/director.mjs';
import { chooseProject, paths, writeMode, writeState } from '../../src/cli/work/store.mjs';
import { repository, writeJson } from './work-fixture.mjs';

export const HOUR = 3600000;
const config = {
  concurrency: 2,
  initializedAt: '2026-01-01T00:00:00Z',
  main: { model: 'fixture/main', effort: 'medium', cwd: '/tmp' },
  background: { harness: 'pi', model: 'fixture/background', effort: 'medium' },
};

export class MemoryRuntime {
  data = { main: null, runs: {}, lastTick: null };
  active = new Map();

  async state() { return structuredClone(this.data); }

  dispatch(request, effect) {
    const controller = new AbortController();
    const run = this.data.runs[request.id] = { ...request, status: 'running' };
    const work = Promise.resolve()
      .then(() => effect(controller.signal))
      .catch(error => ({ status: 'failed', error: error.message }))
      .then(result => Object.assign(run, { status: result.status, result }))
      .finally(() => this.active.delete(request.id));
    this.active.set(request.id, { controller, work });
    return work;
  }

  async cancel(id) {
    this.active.get(id)?.controller.abort();
    await this.active.get(id)?.work;
  }
}

/** A real director on real temporary repositories, with a stand-in for the agents, the clock and `gh`. */
export function director(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-work-')));
  const root = join(base, 'home');
  mkdirSync(root);
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const h = { base, root, clock: Date.parse('2026-06-01T12:00:00Z'), calls: [], agent: async () => {}, gh: async () => { throw Error('This repository has no remote.'); } };
  h.runtime = new MemoryRuntime();
  h.runner = new HobkinRunner({ runtime: h.runtime, root, config, now: () => new Date(h.clock) });
  writeMode(root, { enabled: true, startGapMs: 0, lastDiscoveryAt: new Date(h.clock).toISOString() });
  writeJson(join(root, 'work', 'subscription.json'), { secondary: { usedPercent: 1, windowMinutes: 10080, resetAt: h.clock + 6 * 24 * HOUR } });
  h.director = new WorkDirector({
    root,
    config,
    runner: h.runner,
    runtime: h.runtime,
    now: () => h.clock,
    gh: async (...args) => h.gh(...args),
    claudeProjects: join(base, 'claude-projects'),
    runHarness: async (request, options) => {
      h.calls.push(request);
      await h.agent(request, options);
      return h.result ?? { status: request.signal.aborted ? 'interrupted' : 'completed', text: 'Useful: Done.' };
    },
  });
  h.settled = async () => {
    await Promise.all([...h.runner.jobs.values()]);
    await h.director.watching;
    await h.director.surveying;
    await new Promise(resolve => setImmediate(resolve));
  };
  h.tick = async () => {
    await h.director.tick();
    await h.settled();
  };
  h.ticks = async count => {
    for (let index = 0; index < count; index++) await h.tick();
  };
  h.startedRun = async () => {
    await h.director.tick();
    while (!h.calls.length) await new Promise(resolve => setTimeout(resolve, 10));
  };
  h.work = call => JSON.parse(call.prompt).work;
  return h;
}

/** A project past its study, with nothing due until a test says so. */
export function studied(h, name, level = 'important') {
  const checkout = repository(h.base, name);
  chooseProject(h.root, checkout, level, h.clock);
  mkdirSync(paths(h.root, name).directory, { recursive: true });
  writeFileSync(paths(h.root, name).project, '# What it is\n');
  const now = new Date(h.clock).toISOString();
  writeState(h.root, name, { lastLookAt: now, lastLensAt: now, lastIdeasAt: now });
  return checkout;
}
