import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRun } from '../src/cli/ludicrous/run.mjs';
import { LENSES, planningTasks } from '../src/cli/ludicrous/planning.mjs';
import { git } from './helpers/work-fixture.mjs';
import { ludicrousHome, PLAN, roleOf, SPEC, valuesOf, write, writesOf } from './helpers/ludicrous.mjs';

/** A planner that writes what its task names and ends: drafts, the plan, or specs. */
function plannerWrites(h, agent) {
  for (const path of writesOf(agent)) {
    if (path.endsWith('plan.json')) write(h.folder, path, JSON.stringify(PLAN));
    else if (path.endsWith('/spec.md')) write(h.folder, path, SPEC);
    else write(h.folder, path, `What ${agent.env.LUDICROUS_AGENT} thinks.\n`);
  }
  agent.finish();
}

test('Let\'s plan this runs five planners on max and nothing else, and building waits for Go Ludicrous', async t => {
  const h = ludicrousHome(t);
  const conductor = h.conductor();
  await conductor.plan({ slug: 'harbor', idea: 'A harbor master for every dock.', tier: 30 });

  let most = 0;
  const steps = [];
  for (let n = 0; n < 200 && readRun(h.root).phase === 'planning'; n += 1) {
    await h.ticks(conductor, 1, () => {
      most = Math.max(most, h.pis.running().length);
      const { step } = readRun(h.root);
      if (step && steps.at(-1) !== step) steps.push(step);
    });
    // Each step's planners work only once all of that step's planners have started, as five that run at once would.
    const running = h.pis.running();
    const owed = planningTasks(h.folder, readRun(h.root)).tasks.length;
    if (running.length && running.length >= owed) running.forEach(agent => plannerWrites(h, agent));
  }

  assert.equal(readRun(h.root).phase, 'plan-ready');
  assert.deepEqual(steps, ['drafts', 'critiques', 'plan', 'specs', 'checks', 'settle']);
  assert.ok(h.pis.started.every(agent => roleOf(agent) === 'planner'));
  assert.equal(most, 5);
  assert.ok(h.pis.started.every(agent => valuesOf(agent.args, '--model')[0] === 'fixture/max' && valuesOf(agent.args, '--thinking')[0] === 'max'));
  // Round 1: one draft from each lens, each planner writing only its own file.
  const drafts = h.pis.started.slice(0, 5);
  assert.deepEqual(drafts.map(agent => writesOf(agent)).flat().sort(), LENSES.map(({ id }) => `_specs/ludicrous/planning/round-1/${id}.md`).sort());
  // The plan's areas each got one spec, from the planner the plan named.
  const specWriters = h.pis.started.filter(agent => writesOf(agent).some(path => path.endsWith('/spec.md')));
  assert.deepEqual(specWriters.map(agent => [agent.env.LUDICROUS_AGENT.split('-').at(-1), writesOf(agent)]).sort(), [
    ['architecture', ['_specs/foundation/spec.md']], ['data', ['_specs/api/spec.md']],
  ]);
  assert.match(git(h.folder, 'log', '--format=%s', 'ludicrous/harbor'), /Ludicrous planning: settle\n[\s\S]*Ludicrous planning: drafts/);

  // A plan that is ready waits for the user: nothing starts.
  const before = h.pis.started.length;
  await h.ticks(conductor, 5);
  assert.equal(h.pis.started.length, before);
  const view = conductor.view().run;
  assert.deepEqual(view.plan.areas.map(({ id }) => id), ['foundation', 'api']);
  assert.equal(view.plan.questions[0].pick, 'b');

  // Go Ludicrous with the planners' pick builds at once: the foundation's leader is the first agent.
  await conductor.go({ answers: { q1: 'b' } });
  await h.ticks(conductor, 2);
  assert.equal(readRun(h.root).phase, 'building');
  assert.deepEqual(h.pis.started.slice(before).map(agent => agent.env.LUDICROUS_AGENT.split('-').slice(1).join('-')), ['leader-foundation']);
});

test('an answer that changes the plan runs one short step for the delivery planner before building', async t => {
  const h = ludicrousHome(t);
  const conductor = h.conductor();
  await h.building(PLAN);
  const { changeRun } = await import('../src/cli/ludicrous/run.mjs');
  changeRun(h.root, readRun(h.root), { phase: 'plan-ready', buildingSince: null });

  await conductor.go({ answers: { q1: 'a' } });
  assert.equal(readRun(h.root).phase, 'planning');
  await h.ticks(conductor, 2);
  const [delivery] = h.pis.started;
  assert.equal(roleOf(delivery), 'planner');
  assert.match(delivery.args.at(-1), /Where do the files live\? The user's answer: On disk\./);
  assert.deepEqual(writesOf(delivery), ['_specs/ludicrous/planning/answers.md']);
  plannerWrites(h, delivery);
  await h.ticks(conductor, 3);
  assert.equal(readRun(h.root).phase, 'building');
});

test('a planner that ends twice without its file stops planning, and says which', async t => {
  const h = ludicrousHome(t);
  const conductor = h.conductor();
  await conductor.plan({ slug: 'harbor', idea: 'A harbor master for every dock.', tier: 30 });
  for (let n = 0; n < 30 && readRun(h.root).phase === 'planning'; n += 1) {
    await h.ticks(conductor, 1);
    for (const agent of h.pis.running()) {
      if (agent.env.LUDICROUS_AGENT.endsWith('-quality')) agent.finish();
      else plannerWrites(h, agent);
    }
  }
  const run = readRun(h.root);
  assert.equal(run.phase, 'stopped');
  assert.equal(run.planned, false);
  assert.match(run.lines.at(-1), /The quality planner ended twice without writing _specs\/ludicrous\/planning\/round-1\/quality\.md/);
});
