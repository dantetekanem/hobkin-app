import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { readRun, runDirectory } from '../src/cli/ludicrous/run.mjs';
import { ludicrousHome, PLAN, roleOf } from './helpers/ludicrous.mjs';

const packets = (area, count) => Array.from({ length: count }, (_, n) => ({ id: `${area}-${n + 1}`, paths: [`src/${area}/part-${n + 1}.ts`] }));

/** A worker that ends on the provider's words, as Pi records its last reply in the session. */
function endsOnLimit(agent, words) {
  const session = agent.args[agent.args.indexOf('--session') + 1];
  mkdirSync(dirname(session), { recursive: true });
  appendFileSync(session, `${JSON.stringify({ type: 'message', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: words } })}\n`);
  agent.finish({ code: 1 });
}

test('a used-up window starts nothing and fills the tier again at its reset', async t => {
  const h = ludicrousHome(t, { tier: 30 });
  const run = await h.building(PLAN, { statuses: { foundation: { contracts: true } }, queues: { api: packets('api', 40) } });
  const conductor = h.conductor();
  await h.ticks(conductor, 10);
  assert.equal(h.pis.running().length, 10);

  const [first, ...others] = h.pis.running().filter(agent => roleOf(agent) === 'worker');
  endsOnLimit(first, 'You have hit your usage limit. Try again in ~30 min.');
  await h.ticks(conductor, 1);
  const waiting = readRun(h.root);
  assert.equal(waiting.phase, 'waiting');
  assert.equal(Date.parse(waiting.waitingUntil), h.clock.now + 31 * 60000);
  assert.equal(conductor.view().run.waitingUntil, waiting.waitingUntil);

  // Nothing starts, and the agents still running end as they fail, their packets back in the queue with their edits left in the tree.
  const before = h.pis.started.length;
  others.forEach(agent => endsOnLimit(agent, 'You have hit your usage limit.'));
  await h.ticks(conductor, 20);
  assert.equal(h.pis.started.length, before);
  const states = JSON.parse(readFileSync(join(runDirectory(h.root, run.id), 'packets.json'), 'utf8'));
  assert.ok(Object.values(states).every(({ state }) => state === 'back'));
  assert.ok(!h.pis.started.some(agent => roleOf(agent) === 'compile'));

  // At the reset, by itself, the tier fills again, one start each spacing.
  h.clock.now = Date.parse(waiting.waitingUntil);
  await h.ticks(conductor, 1);
  assert.equal(readRun(h.root).phase, 'building');
  // The two leaders were waiting, never calling the model, so they ran on through it. 25 spacings start 25 agents.
  await h.ticks(conductor, 25);
  assert.equal(h.pis.running().length, 2 + 25);
});

test('with no reset time known, one agent tries every 30 minutes until one runs', async t => {
  const h = ludicrousHome(t, { tier: 30 });
  await h.building(PLAN, { statuses: { foundation: { contracts: true } }, queues: { api: packets('api', 40) } });
  const conductor = h.conductor();
  await h.ticks(conductor, 3);
  h.pis.running().forEach(agent => endsOnLimit(agent, 'Rate limit reached for this account.'));
  await h.ticks(conductor, 1);
  const waiting = readRun(h.root);
  assert.equal(waiting.phase, 'waiting');
  assert.equal(Date.parse(waiting.waitingUntil), h.clock.now + 30 * 60000);

  h.clock.now = Date.parse(waiting.waitingUntil);
  const before = h.pis.started.length;
  await h.ticks(conductor, 60);
  assert.equal(h.pis.started.length, before + 1);
  // It ran two minutes without the limit: the tier fills again.
  await h.ticks(conductor, 100);
  assert.equal(h.pis.running().length, 30);
});
