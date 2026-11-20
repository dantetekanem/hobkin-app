// `hobkin proof check` and `stop` (_specs/050-tla-proofs), with no Java: a stub replays TLC's and SANY's output.
// The fixtures in test/fixtures/tlc/ are built from the message templates in TLC 1.7.4's source (tlc2/output/MP.java and
// EC.java) and SANY's, not recorded from a real run. One test runs real TLC, only when HOBKIN_TLC=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProof, parseCheckArgs, runCheck, stopProof } from '../src/cli/proof/check.mjs';
import { jarPath } from '../src/cli/proof/tools.mjs';
import { messageReader, readMessage } from '../src/cli/proof/tool-messages.mjs';
import { readSany } from '../src/cli/proof/sany.mjs';
import { parseDot, parseState, parseValue } from '../src/cli/proof/values.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/tlc/', import.meta.url));
const fixture = name => join(fixtures, name);
const entry = fileURLToPath(new URL('../src/cli/main.mjs', import.meta.url));

function temp(t, prefix) {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

/** A home with the pinned jar in place (empty: the stub never reads it) and the spec in a git project of its own. */
function setting(t) {
  const home = temp(t, 'hobkin-proof-home-');
  const project = realpathSync(temp(t, 'hobkin-proof-project-'));
  execFileSync('git', ['init', '-q'], { cwd: project });
  mkdirSync(join(project, '_specs', 'tla'), { recursive: true });
  for (const name of ['WorkItem.tla', 'WorkItem.cfg']) copyFileSync(fixture(name), join(project, '_specs', 'tla', name));
  mkdirSync(join(home, 'tools', 'tla'), { recursive: true });
  writeFileSync(jarPath(home), '');
  return { home, project, spec: join(project, '_specs', 'tla', 'WorkItem.tla') };
}

/** `java` and `tlapm` wrappers that run the stub with this plan, and the calls they got. */
function stubTools(t, plan) {
  const folder = temp(t, 'hobkin-proof-stub-');
  const log = join(folder, 'calls.jsonl');
  writeFileSync(log, '');
  const planFile = join(folder, 'plan.json');
  writeFileSync(planFile, JSON.stringify({ java: '21.0.2', log, ...plan }));
  const wrapper = name => {
    const path = join(folder, 'bin', name);
    mkdirSync(join(folder, 'bin'), { recursive: true });
    writeFileSync(path, `#!/bin/sh\nHOBKIN_STUB='${planFile}' exec '${process.execPath}' '${fixture('stub-tool.mjs')}' "$@"\n`);
    chmodSync(path, 0o755);
    return path;
  };
  return {
    java: wrapper('java'),
    tlapm: wrapper('tlapm'),
    javaHome: folder,
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)),
  };
}

const events = (home, id) => readFileSync(join(home, 'proofs', id, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const result = (home, id) => JSON.parse(readFileSync(join(home, 'proofs', id, 'result.json'), 'utf8'));

async function check(t, plan, options = {}) {
  const place = setting(t);
  const stub = stubTools(t, plan);
  const run = await runCheck({
    home: place.home,
    spec: place.spec,
    head: 'abc1234',
    workers: 2,
    tools: { java: stub.java, jar: jarPath(place.home), tlapm: null },
    ...options,
  });
  return { ...place, stub, run };
}

const okParse = { sany: { stdout: 'sany-ok.out' } };

test('TLC\'s framed messages are read whole, across chunk edges, and stray lines are kept as text', () => {
  const seen = [];
  const reader = messageReader(message => seen.push(message));
  const text = readFileSync(fixture('tlc-broken.out'), 'utf8');
  for (let at = 0; at < text.length; at += 7) reader.push(text.slice(at, at + 7));
  reader.end();

  const framed = seen.filter(message => message.code !== null);
  assert.deepEqual(framed.slice(0, 3).map(({ code, cls }) => [code, cls]), [[2262, 0], [2187, 0], [2220, 0]]);
  assert.ok(seen.some(message => message.code === null && message.text === 'Parsing file /fixture/WorkItem.tla'));
  const violated = framed.find(message => message.code === 2110);
  assert.deepEqual(violated, { code: 2110, cls: 1, text: 'Invariant MergedAtReviewedHead is violated.' });
  assert.equal(framed.filter(message => message.code === 2217).length, 5);
});

test('each code TLC prints becomes what it means, with its numbers', () => {
  const read = (code, text, cls = 0) => readMessage({ code, cls, text });

  assert.deepEqual(read(2200, 'Progress(14) at 2026-11-20 10:30:01: 1,234,567 states generated (98,000 s/min), 61,950 distinct states found (4,200 ds/min), 3,112 states left on queue.'),
    { kind: 'progress', depth: 14, generated: 1234567, distinct: 61950, queue: 3112 });
  assert.deepEqual(read(2200, 'Progress(3) at 2026-11-20 10:30:01: 40 states generated, 12 distinct states found, 5 states left on queue.'),
    { kind: 'progress', depth: 3, generated: 40, distinct: 12, queue: 5 });
  assert.deepEqual(read(2199, '11 states generated, 8 distinct states found, 2 states left on queue.'), { kind: 'stats', generated: 11, distinct: 8, queue: 2 });
  assert.deepEqual(read(2194, 'The depth of the complete state graph search is 19.'), { kind: 'depth', depth: 19 });
  assert.deepEqual(read(2186, 'Finished in 1203ms at (2026-11-20 10:30:01)'), { kind: 'finished', ms: 1203 });
  assert.equal(read(2193, 'Model checking completed. No error has been found.').kind, 'success');
  assert.deepEqual(read(2110, 'Invariant Safe is violated.', 1), { kind: 'violation', rule: 'Safe', ruleKind: 'invariant' });
  assert.deepEqual(read(2107, 'Invariant TypeOK is violated by the initial state:\n/\\ x = 1\n', 1),
    { kind: 'violation', rule: 'TypeOK', ruleKind: 'invariant', state: '/\\ x = 1\n' });
  assert.deepEqual(read(2114, 'Deadlock reached.', 1), { kind: 'violation', rule: null, ruleKind: 'deadlock' });
  assert.deepEqual(read(2116, 'Temporal properties were violated.\n', 1), { kind: 'violation', rule: null, ruleKind: 'property' });
  // TLC's EC.java maps 2146 to an evaluation failure: the invariant has primes or temporal operators, nothing broke.
  assert.deepEqual(read(2146, 'The invariant Moves is not a state predicate (one with no primes or temporal operators).', 1),
    { kind: 'error', rule: 'Moves', text: 'The invariant Moves is not a state predicate (one with no primes or temporal operators).' });
  assert.deepEqual(read(2121, 'The behavior up to this point is:', 1), { kind: 'trace' });
  assert.deepEqual(read(2217, '2: <Fix line 37, col 8 to line 40, col 39 of module WorkItem>\n/\\ head = 2\n', 4),
    { kind: 'state', n: 2, action: 'Fix', line: 37, text: '/\\ head = 2\n' });
  assert.deepEqual(read(2217, '1: <Initial predicate>\n/\\ head = 0\n', 4), { kind: 'state', n: 1, action: 'Init', line: null, text: '/\\ head = 0\n' });
  assert.deepEqual(read(2218, '6: Stuttering', 4), { kind: 'stuttering', n: 6 });
  assert.deepEqual(read(2122, '2: Back to state: <Fix line 37, col 8 to line 40, col 39 of module WorkItem>\n', 4), { kind: 'back', n: 2, action: 'Fix' });
  assert.deepEqual(read(2772, '<Fix line 37, col 1 to line 37, col 3 of module WorkItem>: 2:3'), { kind: 'coverage', name: 'Fix', distinct: 2, found: 3 });
  assert.deepEqual(read(2772, '<Next line 49, col 1 to line 49, col 4 of module WorkItem (49 9 49 14)>: 0:0'), { kind: 'coverage', name: 'Next', distinct: 0, found: 0 });
  assert.deepEqual(read(2201, 'The coverage statistics at 2026-11-20 10:30:01'), { kind: 'coverage-start' });
  assert.equal(read(2221, '  line 18, col 12 to line 18, col 27 of module WorkItem: 1').kind, 'other');
  assert.deepEqual(read(1000, 'Some error', 1), { kind: 'error', rule: null, text: 'Some error' });
});

test('TLC\'s values become the window\'s values, and anything else stays as its text', () => {
  assert.deepEqual(parseValue('"a \\"b\\""'), { kind: 'string', text: 'a "b"' });
  assert.deepEqual(parseValue('-3'), { kind: 'number', text: '-3' });
  assert.deepEqual(parseValue('TRUE'), { kind: 'boolean', text: 'TRUE' });
  assert.deepEqual(parseValue('i1'), { kind: 'model', text: 'i1' });
  assert.deepEqual(parseValue('{1, 2}'), { kind: 'set', items: [{ kind: 'number', text: '1' }, { kind: 'number', text: '2' }] });
  assert.deepEqual(parseValue('<< >>'), { kind: 'sequence', items: [] });
  assert.deepEqual(parseValue('<<"x", {}>>'), { kind: 'sequence', items: [{ kind: 'string', text: 'x' }, { kind: 'set', items: [] }] });
  assert.deepEqual(parseValue('[state |-> "branch", head |-> 2]'), {
    kind: 'record',
    pairs: [{ key: 'state', value: { kind: 'string', text: 'branch' } }, { key: 'head', value: { kind: 'number', text: '2' } }],
  });
  assert.deepEqual(parseValue('(i1 :> "queued" @@ i2 :>\n    <<1>>)'), {
    kind: 'function',
    pairs: [
      { key: 'i1', value: { kind: 'string', text: 'queued' } },
      { key: 'i2', value: { kind: 'sequence', items: [{ kind: 'number', text: '1' }] } },
    ],
  });
  assert.deepEqual(parseValue('1..3'), { kind: 'raw', text: '1..3' });
  assert.deepEqual(parseValue('[Items -> {0, 1}]'), { kind: 'raw', text: '[Items -> {0, 1}]' });

  assert.deepEqual(parseState('/\\ state = (i1 :> "queued" @@\n     i2 :> "doing")\n/\\ head = 0\n'), [
    { name: 'state', value: { kind: 'function', pairs: [{ key: 'i1', value: { kind: 'string', text: 'queued' } }, { key: 'i2', value: { kind: 'string', text: 'doing' } }] } },
    { name: 'head', value: { kind: 'number', text: '0' } },
  ]);
  assert.deepEqual(parseState('x = 1\n'), [{ name: 'x', value: { kind: 'number', text: '1' } }]);
});

test('the dot dump becomes the state graph: its initial state, its states\' variables and each move with its action', () => {
  const graph = parseDot(readFileSync(fixture('states.dot'), 'utf8'), 8);
  assert.equal(graph.total, 8);
  assert.equal(graph.nodes.length, 8);
  assert.deepEqual(graph.nodes.filter(node => node.initial).map(node => node.id), ['-6340282962451786520']);
  const first = graph.nodes.find(node => node.initial);
  assert.deepEqual(first.vars.map(({ name, value }) => [name, value.text]), [['state', 'queued'], ['head', '0'], ['reviewed', '0']]);
  assert.equal(graph.edges.length, 9);
  assert.deepEqual(graph.edges[0], { from: '-6340282962451786520', to: '4223871211837003112', action: 'Finish' });
  assert.ok(graph.edges.some(edge => edge.from === edge.to && edge.action === 'Review'), 'keeps a move back to the same state');
  assert.ok(!graph.nodes.some(node => node.id === 'Finish'), 'leaves the legend out');
});

test('SANY\'s output says whether the spec parsed, and where it did not', () => {
  assert.deepEqual(readSany(readFileSync(fixture('sany-ok.out'), 'utf8'), 0), { ok: true });
  assert.deepEqual(readSany(readFileSync(fixture('sany-parse-error.out'), 'utf8'), 255), {
    ok: false,
    file: '/fixture/WorkItem.tla',
    line: 24,
    column: 1,
    message: 'Encountered "Beginning of definition" at line 24, column 1 and token "=="',
  });
  assert.deepEqual(readSany(readFileSync(fixture('sany-semantic-error.out'), 'utf8'), 255), {
    ok: false,
    file: '/fixture/WorkItem.tla',
    line: 45,
    column: 17,
    message: 'Unknown operator: `reviewd\'.',
  });
});

test('the check command takes the spec and its flags, and nothing it does not know', () => {
  assert.deepEqual(parseCheckArgs(['_specs/tla/WorkItem.tla', '--cfg', '_specs/tla/Small.cfg', '--project', 'hobkin', '--item', '4f2c', '--head', 'abc1234', '--workers', '3', '--minutes', '5']), {
    spec: '_specs/tla/WorkItem.tla', cfg: '_specs/tla/Small.cfg', project: 'hobkin', item: '4f2c', head: 'abc1234', workers: 3, minutes: 5,
  });
  assert.deepEqual(parseCheckArgs(['WorkItem.tla']), { spec: 'WorkItem.tla' });
  assert.throws(() => parseCheckArgs([]), /Usage: hobkin proof check/);
  assert.throws(() => parseCheckArgs(['A.tla', '--workers', 'many']), /--workers/);
  assert.throws(() => parseCheckArgs(['A.tla', '--fast']), /--fast/);
});

test('a parse error says its file, line and column, and TLC never starts', async t => {
  const { home, run, stub } = await check(t, { sany: { stdout: 'sany-parse-error.out', code: 255 }, tlc: { stdout: 'tlc-holds.out' } });

  assert.equal(run.outcome, 'error');
  assert.equal(run.message, 'The spec does not parse: /fixture/WorkItem.tla, line 24, column 1. Encountered "Beginning of definition" at line 24, column 1 and token "=="');
  assert.deepEqual(run.steps.map(({ id, state }) => [id, state]), [['parse', 'failed'], ['check', 'skipped'], ['prove', 'skipped']]);
  assert.ok(!stub.calls().some(call => call.args.includes('tlc2.TLC')), 'TLC never ran');
  assert.equal(result(home, run.id).outcome, 'error');
  assert.equal(existsSync(join(home, 'proofs', run.id, 'pid')), false);
});

test('a broken invariant ends broken, with its stats and the shortest trace of states with their actions in trace.json', async t => {
  const { home, run, stub } = await check(t, { ...okParse, tlc: { stdout: 'tlc-broken.out', code: 12 }, graph: { stdout: 'tlc-broken.out', code: 12, dot: 'states.dot' } });

  assert.equal(run.outcome, 'broken');
  assert.equal(run.broken, 'MergedAtReviewedHead');
  assert.deepEqual(run.stats, { generated: 11, distinct: 8, queue: 2, depth: 5 });
  assert.deepEqual(run.rules.map(({ name, kind, status }) => [name, kind, status]), [
    ['TypeOK', 'invariant', 'holds'],
    ['MergedAtReviewedHead', 'invariant', 'broken'],
  ]);
  assert.equal(run.rules[1].words, 'Whatever merged was reviewed at the head that merged.');
  assert.equal(run.traceLength, 5);
  assert.deepEqual(run.trace.map(({ n, action, code }) => [n, action, code]), [
    [1, 'Init', undefined],
    [2, 'Finish', 'src/cli/work/runner.mjs:88'],
    [3, 'Review', 'src/cli/work/review.mjs:61'],
    [4, 'Fix', 'src/cli/work/runner.mjs:203'],
    [5, 'YoloMerge', 'src/cli/work/yolo-pass.mjs:165'],
  ]);
  assert.deepEqual(run.trace[4].vars.map(({ name, value }) => [name, value.text]), [['state', 'merged'], ['head', '2'], ['reviewed', '1']]);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'proofs', run.id, 'trace.json'), 'utf8')), run.trace);
  assert.equal(run.graph.nodes.length, 8);
  assert.equal(run.graph.total, 8);
  assert.equal(run.counts, false);

  const tlc = stub.calls().find(call => call.args.includes('tlc2.TLC'));
  for (const flag of ['-tool', '-workers', '-coverage', '-config', '-metadir']) assert.ok(tlc.args.includes(flag), `TLC runs with ${flag}`);
  assert.equal(tlc.args[tlc.args.indexOf('-workers') + 1], '2');
  assert.equal(tlc.args[tlc.args.indexOf('-coverage') + 1], '1');
  assert.ok(tlc.args.some(arg => /^-Xmx\d+m$/.test(arg)), 'with a heap cap');
  assert.ok(!tlc.args.includes('-dump'), 'the check itself dumps nothing');
  const graph = stub.calls().find(call => call.args.includes('-dump'));
  assert.equal(graph.args[graph.args.indexOf('-dump') + 1], 'dot,actionlabels,colorize');
});

test('the events tell the run as it goes, and the record ends with the outcome and its final stats', async t => {
  const { home, project, run } = await check(t, { ...okParse, tlc: { stdout: 'tlc-holds.out' }, graph: { stdout: 'tlc-holds.out', dot: 'states.dot' } }, { project: 'hobkin', item: '4f2c' });
  const lines = events(home, run.id);
  const types = lines.map(event => event.type);

  assert.equal(types[0], 'start');
  assert.deepEqual(lines[0], {
    type: 'start', at: lines[0].at, spec: '_specs/tla/WorkItem.tla', cfg: '_specs/tla/WorkItem.cfg', project: 'hobkin', item: '4f2c',
    head: 'abc1234', tool: 'TLC 1.7.4', workers: 2, model: 'MaxPush = 2', root: project,
  });
  assert.equal(types.at(-1), 'end');
  assert.deepEqual(lines.at(-1), { type: 'end', at: lines.at(-1).at, outcome: 'holds' });
  for (const type of ['step', 'definitions', 'rule', 'progress', 'action', 'log']) assert.ok(types.includes(type), `writes ${type} events`);
  assert.ok(lines.findIndex(event => event.type === 'step' && event.step === 'parse' && event.state === 'done') < lines.findIndex(event => event.type === 'step' && event.step === 'check' && event.state === 'running'));

  const record = result(home, run.id);
  assert.equal(record.outcome, 'holds');
  assert.deepEqual(record.stats, { generated: 14, distinct: 8, queue: 0, depth: 5 });
  assert.deepEqual(record.actions, [
    { name: 'Finish', count: 1, code: 'src/cli/work/runner.mjs:88' },
    { name: 'Review', count: 3, code: 'src/cli/work/review.mjs:61' },
    { name: 'Fix', count: 2, code: 'src/cli/work/runner.mjs:203' },
    { name: 'YoloMerge', count: 2, code: 'src/cli/work/yolo-pass.mjs:165' },
  ]);
  assert.deepEqual(record.rules.map(rule => rule.status), ['holds', 'holds']);
  assert.equal(record.counts, true);
  assert.equal(record.specHash, createHash('sha256').update(readFileSync(fixture('WorkItem.tla'))).digest('hex'));
  assert.equal(record.cfgHash, createHash('sha256').update(readFileSync(fixture('WorkItem.cfg'))).digest('hex'));
  assert.equal(record.root, run.root);
  assert.ok(record.started && record.finished);
  assert.ok(record.samples.length >= 1);
  assert.ok(record.definitions.some(definition => definition.name === 'YoloMerge' && definition.lines[0].startsWith('YoloMerge ≜ ∧')));
  assert.ok(record.log.every(line => line.at && line.text && line.tone));
  assert.match(record.log.at(-1).text, /holds/);
  assert.equal(existsSync(join(home, 'proofs', run.id, 'pid')), false, 'the pid file goes when the run ends');
  assert.equal(existsSync(join(home, 'proofs', run.id, 'states')), false, 'TLC\'s own state files go too');
});

test('an action that never fired is named, and the run does not count as evidence', async t => {
  const { run } = await check(t, { ...okParse, tlc: { stdout: 'tlc-never-fired.out' }, graph: { stdout: 'tlc-never-fired.out', dot: 'states.dot' } });

  assert.equal(run.outcome, 'holds');
  assert.deepEqual(run.actions.find(action => action.name === 'YoloMerge'), { name: 'YoloMerge', count: 0, code: 'src/cli/work/yolo-pass.mjs:165' });
  assert.equal(run.counts, false);
  assert.ok(run.log.some(line => line.tone === 'bad' && /YoloMerge never fired/.test(line.text)));
});

test('a deadlock and a broken temporal property leave their traces, and a broken initial state its one state', async t => {
  const dir = setting(t);
  const cfg = (name, text) => {
    const path = join(dir.project, '_specs', 'tla', name);
    writeFileSync(path, text);
    return path;
  };
  const checkWith = async (plan, cfgPath) => {
    const stub = stubTools(t, { ...okParse, ...plan });
    return runCheck({ home: dir.home, spec: dir.spec, cfg: cfgPath, workers: 1, tools: { java: stub.java, jar: jarPath(dir.home), tlapm: null } });
  };

  const deadlock = await checkWith({ tlc: { stdout: 'tlc-deadlock.out', code: 11 } }, cfg('Stuck.cfg', 'CONSTANT MaxPush = 2\nSPECIFICATION Spec\nINVARIANT TypeOK\n'));
  assert.equal(deadlock.outcome, 'broken');
  assert.equal(deadlock.broken, 'Deadlock');
  assert.deepEqual(deadlock.rules.map(({ name, kind, status }) => [name, kind, status]), [['TypeOK', 'invariant', 'holds'], ['Deadlock', 'deadlock', 'broken']]);
  assert.deepEqual(deadlock.trace.map(state => state.action), ['Init', 'Finish', 'Review', 'YoloMerge']);

  const temporal = await checkWith({ tlc: { stdout: 'tlc-temporal.out', code: 13 } }, cfg('Live.cfg', 'CONSTANT MaxPush = 2\nSPECIFICATION Spec\nPROPERTY EventuallyMerged\n'));
  assert.equal(temporal.outcome, 'broken');
  assert.equal(temporal.broken, 'EventuallyMerged');
  assert.deepEqual(temporal.rules.map(({ name, kind, status }) => [name, kind, status]), [['EventuallyMerged', 'property', 'broken'], ['Deadlock', 'deadlock', 'holds']]);
  assert.deepEqual(temporal.trace.map(state => state.action), ['Init', 'Finish', 'Stuttering']);
  assert.deepEqual(temporal.trace[2].vars, temporal.trace[1].vars);

  const initial = await checkWith({ tlc: { stdout: 'tlc-initial.out', code: 12 } });
  assert.equal(initial.broken, 'TypeOK');
  assert.deepEqual(initial.trace.map(({ n, action }) => [n, action]), [[1, 'Init']]);
  assert.equal(initial.trace[0].vars[0].value.text, 'lost');

  const level = await checkWith({ tlc: { stdout: 'tlc-level-error.out', code: 76 } });
  assert.equal(level.outcome, 'error');
  assert.equal(level.message, 'The invariant MergedAtReviewedHead is not a state predicate (one with no primes or temporal operators).');
});

test('a run whose model has more than 50,000 states ends with no graph and says so', async t => {
  const big = readFileSync(fixture('tlc-holds.out'), 'utf8')
    .replace('14 states generated, 8 distinct states found', '240,000 states generated, 60,000 distinct states found')
    .replace(/: 14 states generated \(840 s\/min\), 8 distinct states found/, ': 240,000 states generated (840 s/min), 60,000 distinct states found');
  const place = setting(t);
  writeFileSync(join(place.project, 'big.out'), big);
  const stub = stubTools(t, { ...okParse, tlc: { stdout: join(place.project, 'big.out') } });
  const run = await runCheck({ home: place.home, spec: place.spec, workers: 1, tools: { java: stub.java, jar: jarPath(place.home), tlapm: null } });

  assert.equal(run.outcome, 'holds');
  assert.equal(run.stats.distinct, 60000);
  assert.equal(run.graph, undefined);
  assert.equal(run.graphNote, 'The model has 60,000 states, more than the 50,000 hobkin draws, so there is no state graph.');
  assert.ok(!stub.calls().some(call => call.args.includes('-dump')), 'TLC never dumped the graph');
});

test('a run past its time limit is stopped and says why', async t => {
  const { run } = await check(t, { ...okParse, tlc: { holdMs: 60000 } }, { minutes: 0.005 });
  assert.equal(run.outcome, 'stopped');
  assert.equal(run.message, 'Stopped at the time limit of 0.005 minutes.');
});

test('one TLC runs at a time: a second check waits for the first', async t => {
  const place = setting(t);
  const stub = stubTools(t, { ...okParse, tlc: { stdout: 'tlc-holds.out', holdMs: 600 }, graph: { stdout: 'tlc-holds.out', dot: 'states.dot' } });
  const options = { home: place.home, spec: place.spec, workers: 1, tools: { java: stub.java, jar: jarPath(place.home), tlapm: null } };
  const [first, second] = await Promise.all([runCheck(options), runCheck(options)]);

  assert.equal(first.outcome, 'holds');
  assert.equal(second.outcome, 'holds');
  const waited = [first, second].find(run => run.log.some(line => /Waiting for run/.test(line.text)));
  assert.ok(waited, 'one of them waited');
  const tlcRuns = stub.calls().filter(call => call.args.includes('tlc2.TLC') && !call.args.includes('-dump'));
  assert.equal(tlcRuns.length, 2);
});

/**
 * Starts `hobkin proof check` as its own process the way work mode does: from a tree at the item's head, with the spec
 * relative to it, and the stub found through JAVA_HOME.
 */
function startCli(place, stub) {
  const args = [entry, 'proof', 'check', '_specs/tla/WorkItem.tla', '--project', 'hobkin', '--item', '4f2c', '--head', 'abc1234', '--home', place.home, '--workers', '1'];
  const child = spawn(process.execPath, args, {
    cwd: place.project,
    env: { ...process.env, JAVA_HOME: stub.javaHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.on('exit', code => resolve({ code, output })));
  return { child, exited };
}

const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function runFolders(folder) {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}

async function until(condition, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = condition();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Timed out waiting.');
}

test('stop ends the Java process within 2 seconds, even one that ignores its first signal, and records stopped', async t => {
  const place = setting(t);
  const stub = stubTools(t, { ...okParse, tlc: { holdMs: 60000, ignoreTerm: true } });
  const { exited } = startCli(place, stub);
  const tlc = await until(() => stub.calls().find(call => call.args.includes('tlc2.TLC')));
  const folder = join(place.home, 'proofs');
  const id = await until(() => runFolders(folder).find(name => existsSync(join(folder, name, 'pid'))));

  const asked = Date.now();
  const said = await stopProof({ home: place.home, id });
  const took = Date.now() - asked;

  assert.ok(took < 2000, `took ${took} ms`);
  assert.equal(alive(tlc.pid), false, 'the Java process is gone');
  assert.match(said.message, /Stopped run/);
  const { code } = await exited;
  assert.notEqual(code, 0);
  const record = result(place.home, id);
  assert.equal(record.outcome, 'stopped');
  assert.deepEqual([record.spec, record.project, record.item, record.head], ['_specs/tla/WorkItem.tla', 'hobkin', '4f2c', 'abc1234']);
  assert.equal(existsSync(join(place.home, 'proofs', id, 'pid')), false);
});

test('the host starts a check as its own process and gets its id back at once', async t => {
  const place = setting(t);
  const stub = stubTools(t, { ...okParse, tlc: { stdout: 'tlc-holds.out' }, graph: { stdout: 'tlc-holds.out', dot: 'states.dot' } });
  const started = await checkProof({ home: place.home, spec: '_specs/tla/WorkItem.tla', root: place.project, env: { ...process.env, JAVA_HOME: stub.javaHome } });

  assert.match(started.id, /^\d{8}-\d{6}-workitem-[a-z0-9]{4}$/);
  assert.match(started.message, /Started the check of _specs\/tla\/WorkItem\.tla/);
  const record = await until(() => existsSync(join(place.home, 'proofs', started.id, 'result.json')) && result(place.home, started.id));
  assert.equal(record.outcome, 'holds');
  assert.equal(record.spec, '_specs/tla/WorkItem.tla');
});

test('real TLC checks the fixture spec, only with HOBKIN_TLC=1', { skip: process.env.HOBKIN_TLC !== '1' }, async t => {
  const home = temp(t, 'hobkin-proof-real-');
  const real = process.env.HOBKIN_TLC_JAR;
  assert.ok(real, 'set HOBKIN_TLC_JAR to a tla2tools.jar 1.7.4');
  mkdirSync(join(home, 'tools', 'tla'), { recursive: true });
  copyFileSync(real, jarPath(home));
  const run = await runCheck({ home, spec: fixture('WorkItem.tla'), workers: 1 });

  assert.equal(run.outcome, 'broken');
  assert.equal(run.broken, 'MergedAtReviewedHead');
  assert.deepEqual(run.trace.map(state => state.action), ['Init', 'Finish', 'Review', 'Fix', 'YoloMerge']);
  assert.ok(run.actions.every(action => action.count > 0));
  assert.ok(run.graph?.nodes.length > 0);
});
