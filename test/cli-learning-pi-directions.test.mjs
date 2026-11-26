import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize, setLearning } from '../src/cli/config.mjs';
import { directionsPath } from '../src/cli/directions.mjs';
import { buildInvocation } from '../src/cli/harnesses.mjs';
import { learningView, runLearningCommand } from '../src/cli/learning/commands.mjs';
import { PiDirectionsLearner } from '../src/cli/learning/pi-directions-learner.mjs';
import { readPiDirections } from '../src/cli/learning/pi-directions.mjs';
import { learningState, saveState } from '../src/cli/learning/store.mjs';
import { listActionItems, readPending, readWaiting } from '../src/cli/pending-read.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const DAY = 86400000;
const RULES = ['Ask before sending any message for the user.', 'Prove each claim with a file, a command or a source.'];
const answer = rules => ({ status: 'completed', text: JSON.stringify({ rules }), cost: null });

// A home and a Pi folder of the test's own, so nothing here reads ~/.pi/agent or ~/.hobkin.
function home(t, { learning = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-pi-directions-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  config.tiers = { fast: { model: 'fixture/fast', effort: 'low' } };
  atomicJson(join(root, 'config.json'), config);
  setLearning(root, learning);
  writeFileSync(directionsPath(root), '# Directions\n\n- Keep replies short.\n', { mode: 0o600 });
  const agentDir = join(root, 'pi-agent');
  mkdirSync(agentDir);
  return { root, agentDir };
}

function learner(t, { root, agentDir }, reply = answer(RULES), now = Date.now) {
  const requests = [];
  const runHarness = async request => {
    requests.push(request);
    return typeof reply === 'function' ? reply(request) : reply;
  };
  const piDirections = new PiDirectionsLearner({ root, agentDir, runHarness, now });
  t.after(() => piDirections.close());
  return { piDirections, requests };
}

const writePi = ({ agentDir }, text, name = 'AGENTS.md') => writeFileSync(join(agentDir, name), text);

async function look(piDirections) {
  piDirections.tick();
  await piDirections.idle();
}

test("Pi's AGENTS.md is compared once per version on the fast tier, in a run that loads nothing of Pi's", async t => {
  const where = home(t);
  writePi(where, '# Pi\n\n- Keep replies short.\n');
  const { piDirections, requests } = learner(t, where, answer([]));

  await look(piDirections);
  await look(piDirections);

  assert.equal(requests.length, 1, 'a version already looked at is not compared again');
  const [request] = requests;
  assert.equal(request.purpose, 'pi-directions');
  assert.deepEqual([request.harness, request.model, request.effort], ['pi', 'fixture/fast', 'low']);
  assert.match(request.prompt, /<your-directions>\n[\s\S]*- Keep replies short\.[\s\S]*\n<\/your-directions>/);
  assert.match(request.prompt, /<pi-agents-md>\n# Pi\n\n- Keep replies short\.\n\n<\/pi-agents-md>/);
  const { args } = buildInvocation({ ...request, sessionFile: join(where.root, 'job.jsonl') });
  for (const flag of ['--no-tools', '--no-extensions', '--no-skills', '--no-context-files', '--system-prompt']) assert.ok(args.includes(flag), flag);
  assert.match(args[args.indexOf('--system-prompt') + 1], /Pi's AGENTS\.md/);

  assert.equal(typeof readPiDirections(where.root).looked, 'string', 'the version looked at is kept in the home');
  assert.deepEqual(learningState(where.root).proposals, [], 'nothing to bring in files nothing');
  assert.equal(statSync(join(where.root, 'runtime', 'pi-directions.json')).mode & 0o777, 0o600);

  // A start looks again and finds the same version, so there is no second run.
  const restarted = learner(t, where);
  await look(restarted.piDirections);
  assert.equal(restarted.requests.length, 0);
});

test('rules Your directions lack are filed as one learning proposal that waits in Action Items, and a new version replaces it', async t => {
  const where = home(t);
  writePi(where, '# Pi\n\n- Ask before sending.\n- Prove claims.\n');
  const { piDirections } = learner(t, where);

  await look(piDirections);

  const [proposal, ...more] = learningState(where.root).proposals;
  assert.equal(more.length, 0);
  assert.equal(proposal.kind, 'directions');
  assert.deepEqual(proposal.rules, RULES);
  const [waiting] = readWaiting(where.root).proposals;
  assert.equal(waiting.id, proposal.id);
  assert.match(waiting.question, /^Pi's AGENTS\.md has 2 rules that Your directions lack:\n- Ask before sending any message for the user\.\n- Prove each claim with a file, a command or a source\.\nAdd them to Your directions\?$/);
  assert.deepEqual(listActionItems(where.root).items.map(({ id, group }) => [id, group]), [[`learning:${proposal.id}:${proposal.at}`, 'learning']]);
  assert.match(learningView(where.root), /Pi's AGENTS\.md has 2 rules/);

  // Pi's file changes once more, and the new look stands in for the proposal that was waiting.
  writePi(where, '# Pi\n\n- Ask before sending.\n');
  const next = learner(t, where, answer([RULES[0]]));
  await look(next.piDirections);
  const proposals = learningState(where.root).proposals;
  assert.deepEqual(proposals.map(({ rules }) => rules), [[RULES[0]]]);
  assert.notEqual(proposals[0].id, proposal.id);
  assert.match(readWaiting(where.root).proposals[0].question, /has one rule that Your directions lack:\n- .+\nAdd it to Your directions\?$/);
});

test('a compare that fails or answers out of form files nothing and is tried again on the next change or start', async t => {
  const where = home(t);
  writePi(where, '# Pi\n\n- Ask before sending.\n');
  for (const reply of [{ status: 'failed', error: 'refused', cost: null }, { status: 'completed', text: 'Add a rule about sending.', cost: null }]) {
    const { piDirections, requests } = learner(t, where, reply);
    await look(piDirections);
    await look(piDirections);
    assert.equal(requests.length, 1, 'a failed version waits for a change or a start');
    assert.equal(readPiDirections(where.root).looked, null);
    assert.deepEqual(learningState(where.root).proposals, []);
  }

  const { piDirections, requests } = learner(t, where, { status: 'failed', error: 'refused', cost: null });
  await look(piDirections);
  writePi(where, '# Pi\n\n- Ask before sending.\n- Prove claims.\n');
  await look(piDirections);
  assert.equal(requests.length, 2, 'a change is looked at again');
});

test("with Learning off a new Pi file still files its one proposal, which waits in Action Items and takes yes, later and no, while learning's own stay hidden", async t => {
  const off = home(t, { learning: false });
  writePi(off, '# Pi\n\n- Ask before sending.\n');
  const { piDirections, requests } = learner(t, off);
  await look(piDirections);
  assert.equal(requests.length, 1);

  const routine = { id: 'abc123', scope: 'mail', kind: 'rethink', title: 'Mail', code: 'blocked', seen: 6, runs: 8, days: 8, latest: '2026-01-02T00:00:00.000Z', at: '2026-01-02T00:00:00.000Z' };
  saveState(off.root, { lessons: [], proposals: [routine], pullRequests: {} });
  const [proposal] = learningState(off.root).proposals.filter(({ kind }) => kind === 'directions');
  assert.deepEqual(readWaiting(off.root).proposals.map(({ id }) => id), [proposal.id], "learning's own proposals stay behind the switch");
  assert.deepEqual(listActionItems(off.root).items.map(({ id }) => id), [`learning:${proposal.id}:${proposal.at}`]);
  assert.equal(readPending(off.root).groups.find(({ name }) => name === 'questions')?.count, 1);

  runLearningCommand(off.root, ['answer', proposal.id, 'later']);
  assert.deepEqual(readWaiting(off.root).proposals, []);

  writePi(off, '# Pi\n\n- Ask before sending.\n- Prove claims.\n');
  await look(piDirections);
  const [next] = readWaiting(off.root).proposals;
  for (const choice of ['no', 'yes']) assert.deepEqual(runLearningCommand(off.root, ['answer', next.id, choice]), { id: next.id, answer: 'no' }, 'the first answer is the last word');
  assert.deepEqual(readWaiting(off.root).proposals, []);
});

test('nothing is compared without a named Pi folder, or with no AGENTS.md there', async t => {
  const unnamed = home(t);
  const none = learner(t, { root: unnamed.root, agentDir: undefined });
  await look(none.piDirections);
  const empty = learner(t, unnamed);
  await look(empty.piDirections);
  assert.equal(none.requests.length + empty.requests.length, 0);
});

test("a linked AGENTS.md is read as Pi reads it, and Pi's own order picks the file", async t => {
  const where = home(t);
  const kept = join(where.root, 'kept-agents.md');
  writeFileSync(kept, '# Linked\n');
  symlinkSync(kept, join(where.agentDir, 'AGENTS.md'));
  writePi(where, '# Override\n', 'AGENTS.override.md');
  const { piDirections, requests } = learner(t, where);
  await look(piDirections);
  assert.match(requests[0].prompt, /<pi-agents-md>\n# Override\n/);

  rmSync(join(where.agentDir, 'AGENTS.override.md'));
  await look(piDirections);
  assert.match(requests[1].prompt, /<pi-agents-md>\n# Linked\n/);
});

test('later brings the proposal back in a week, and no leaves it out until Pi changes its file', async t => {
  const where = home(t);
  writePi(where, '# Pi\n\n- Ask before sending.\n');
  const { piDirections } = learner(t, where, answer(RULES), () => Date.now() - 20 * DAY);
  await look(piDirections);
  const [proposal] = learningState(where.root).proposals;

  runLearningCommand(where.root, ['answer', proposal.id, 'later'], { now: Date.now() - 10 * DAY });
  const [back] = learningState(where.root).proposals;
  assert.equal(back.id, proposal.id, 'a week after a later it is asked again');
  assert.ok(Date.parse(back.at) > Date.parse(proposal.at), 'under a newer time, so Action Items shows it anew');

  runLearningCommand(where.root, ['answer', proposal.id, 'later'], { now: Date.now() - DAY });
  assert.deepEqual(learningState(where.root).proposals, [], 'a later puts it off for a week');

  const fresh = home(t);
  writePi(fresh, '# Pi\n\n- Ask before sending.\n');
  const asked = learner(t, fresh);
  await look(asked.piDirections);
  const [declined] = learningState(fresh.root).proposals;
  runLearningCommand(fresh.root, ['answer', declined.id, 'no']);
  await look(asked.piDirections);
  assert.deepEqual(learningState(fresh.root).proposals, []);
  assert.equal(asked.requests.length, 1, 'a no holds for this version of the file');

  writePi(fresh, '# Pi\n\n- Ask before sending.\n- Prove claims.\n');
  await look(asked.piDirections);
  assert.equal(learningState(fresh.root).proposals.length, 1, 'a change asks again');
});

test("hobkin looks at the Pi folder it is given as it starts, and a yes hands exactly the rules to the main agent, with Learning off too", { timeout: 15000 }, async t => {
  const where = home(t, { learning: false });
  writePi(where, '# Pi\n\n- Ask before sending.\n- Prove claims.\n');
  const fake = fakePi(where.root);
  const asked = Promise.withResolvers();
  const runHarness = async request => {
    if (request.purpose !== 'pi-directions') return { status: 'failed', error: `Unexpected ${request.purpose} job.`, cost: null };
    asked.resolve(request);
    return answer(RULES);
  };
  const app = await HobkinApplication.open(where.root, { createMain: fake.createMain, runHarness, intervalMs: 60000, piAgentDir: where.agentDir });
  t.after(() => app.close());

  assert.equal((await asked.promise).model, 'fixture/fast');
  await app.piDirections.idle();
  const [proposal] = (await app.refresh()).waiting.proposals;
  assert.equal(proposal.kind, 'directions');

  const said = await app.workAction('learning', proposal.id, 'yes');
  await app.outgoing;
  await app.runtime.idle();
  assert.match(said.message, /adds them to Your directions/);
  const sent = app.runtime.messages().find(message => message.role === 'user').content;
  for (const rule of RULES) assert.ok(sent.includes(`- ${rule}`), rule);
  assert.deepEqual((await app.refresh()).waiting.proposals, []);
  assert.equal(readFileSync(directionsPath(where.root), 'utf8'), '# Directions\n\n- Keep replies short.\n', 'only the main agent writes them in');
});

test('a home opened with no Pi folder named never looks at one', async t => {
  const where = home(t);
  const fake = fakePi(where.root);
  const app = await HobkinApplication.open(where.root, { createMain: fake.createMain, intervalMs: 60000 });
  t.after(() => app.close());
  assert.equal(app.piDirections, null);
});
