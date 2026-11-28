import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { initialize } from '../../src/cli/config.mjs';
import { LudicrousConductor } from '../../src/cli/ludicrous/conductor.mjs';
import { changeRun, planRun, readRun } from '../../src/cli/ludicrous/run.mjs';
import { chooseProject } from '../../src/cli/work/store.mjs';
import { git, repository, withOrigin } from './work-fixture.mjs';

/**
 * A Ludicrous run as the tests play it: a throwaway home with one project, `harbor`, and fake Pi processes that start nothing. A test reads
 * what each was asked to do and ends it when it likes. The clock moves only when a test moves it, and nothing touches `~/.hobkin`.
 */

export const NOW = Date.parse('2026-11-27T12:00:00Z');
export const CONFIG = {
  tiers: Object.fromEntries(['fast', 'mid', 'high', 'max'].map(tier => [tier, { model: `fixture/${tier}`, effort: tier === 'max' ? 'max' : 'medium' }])),
  main: { model: 'fixture/main', effort: 'medium' },
  background: { model: 'fixture/background', effort: 'medium' },
};
const roomy = () => ({ cores: 18, memoryMb: 65536, freeDiskMb: 1_000_000, stdioMcp: 0 });

export const valuesOf = (args, flag) => args.flatMap((arg, at) => (arg === flag ? [args[at + 1]] : []));
export const taskOf = agent => agent.args.at(-1);
export const roleOf = agent => agent.env.LUDICROUS_AGENT.split('-')[1];
/** The paths a task tells its agent to write, from its "- path" lines. */
export const writesOf = agent => taskOf(agent).split('\n').filter(line => /^- [\w_./-]+$/.test(line)).map(line => line.slice(2));

export function fakePis() {
  const started = [];
  const killed = [];
  const start = ({ command, args, cwd, env, log }) => {
    let end;
    const exited = new Promise(resolve => {
      end = resolve;
    });
    const agent = { command, args, cwd, env, log, pid: 40000 + started.length, done: false };
    agent.finish = (result = {}) => {
      agent.done = true;
      end({ code: 0, signal: null, error: null, ...result });
    };
    started.push(agent);
    return { pid: agent.pid, exited };
  };
  const kill = pid => {
    killed.push(pid);
    started.find(agent => agent.pid === pid && !agent.done)?.finish({ code: null, signal: 'SIGKILL' });
    return true;
  };
  const running = () => started.filter(agent => !agent.done);
  return { started, killed, start, kill, running };
}

export function write(folder, path, text) {
  mkdirSync(dirname(join(folder, path)), { recursive: true });
  writeFileSync(join(folder, path), text);
}

export const queueLine = packet => `${JSON.stringify({ step: 'S1', tier: 'mid', ...packet })}\n`;

export function ludicrousHome(t, { origin = true, tier = 30 } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-ludicrous-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const folder = repository(base, 'harbor');
  if (origin) withOrigin(base, folder);
  chooseProject(root, folder, 'important', NOW);
  const pis = fakePis();
  const clock = { now: NOW };
  const awake = { holds: 0, releases: 0 };
  const h = {
    base, root, folder, pis, clock, awake, tier,
    conductor(change = {}) {
      return new LudicrousConductor({
        root, config: CONFIG, now: () => clock.now, start: pis.start, kill: pis.kill, left: async groups => groups, sweepRun: async () => 0,
        awake: () => {
          awake.holds += 1;
          return () => {
            awake.releases += 1;
          };
        },
        measure: roomy, spacingMs: 1000, ...change,
      });
    },
    async ticks(conductor, count = 1, each = () => {}) {
      for (let n = 0; n < count; n += 1) {
        clock.now += 1000;
        await new Promise(resolve => setImmediate(resolve));
        await conductor.tick();
        each();
      }
    },
    plan: () => planRun(root, { slug: 'harbor', idea: 'A harbor master for every dock.', tier }, { now: clock.now, measure: roomy }),
    /** A run that planned and builds now, from `plan`, with each area's status and queue as the test gives them. */
    async building(plan, { statuses = {}, queues = {} } = {}) {
      const run = await h.plan();
      write(folder, '_specs/ludicrous/plan.json', JSON.stringify(plan));
      for (const [area, status] of Object.entries(statuses)) write(folder, `_specs/ludicrous/trails/${area}/status.json`, JSON.stringify(status));
      for (const [area, packets] of Object.entries(queues)) write(folder, `_specs/ludicrous/trails/${area}/queue.jsonl`, packets.map(queueLine).join(''));
      git(folder, 'add', '.');
      git(folder, 'commit', '-qm', 'The plan');
      return changeRun(root, readRun(root, run.id), { phase: 'building', planned: true, approved: true, step: null, buildingSince: new Date(clock.now).toISOString() });
    },
  };
  return h;
}

export const PLAN = {
  areas: [
    { id: 'foundation', name: 'Foundation', depends: [], writer: 'architecture', checks: ['pnpm test'], leaderPaths: ['package.json'] },
    { id: 'api', name: 'API', depends: ['foundation'], writer: 'data', checks: ['pnpm --filter api test'] },
  ],
  checkCommands: ['pnpm'],
  questions: [{ id: 'q1', question: 'Where do the files live?', options: [{ id: 'a', label: 'On disk' }, { id: 'b', label: 'In S3' }], pick: 'b' }],
};

export const SPEC = '---\n{ "id": "area" }\n---\n# Area\n\n## Outcome\nIt works.\n\n## Steps\n- [ ] S1 (A1). First.\n- [ ] S2 (A1). Second.\n';
