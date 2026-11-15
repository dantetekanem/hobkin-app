import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { buildInvocation, closeKept, namingExtensions, runHarness } from '../src/cli/harnesses.mjs';
import { extensionPaths, LEFT_OUT_OF_THE_MAIN_CHAT } from '../src/cli/pi-extensions.mjs';
import { readEvents } from '../src/cli/events.mjs';
import { startRpcProcess } from '../src/cli/rpc-process.mjs';

const id = 'f094b0ba-036c-4abc-9198-745fd1226765';
function request(t, harness = 'pi') {
  const cwd = mkdtempSync(join(tmpdir(), 'hobkin-harness-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return {
    id,
    harness,
    cwd,
    model: null,
    effort: 'medium',
    prompt: 'A quoted "request"\nwith context.',
    sessionFile: join(cwd, 'job.jsonl'),
  };
}
function fake(program, calls = []) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    return spawn(process.execPath, ['--input-type=module', '-e', program], options);
  };
}
const restrictedPiFlags = [
  '--no-tools', '--no-builtin-tools', '--tools', '--exclude-tools',
  '--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates',
  '--no-themes', '--no-context-files', '--no-approve', '--system-prompt',
];
function assertOrdinaryPiDefaults(args) {
  for (const flag of restrictedPiFlags) {
    assert.ok(!args.includes(flag), `${flag} should use Pi defaults`);
  }
  const appended = args.indexOf('--append-system-prompt');
  assert.ok(appended >= 0 && args[appended + 1].trim(), 'Hobkin instructions should extend the normal Pi prompt');
}
const rpc = (body, thinking = 'medium', model = { provider: 'test', id: 'model' }, statsResponse = "reply({ sessionId: 'pi-job', cost: 0.25, tokens: { input: 10, output: 5 } })") => `
let input = '';
const send = event => process.stdout.write(JSON.stringify(event) + '\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  let end;
  while ((end = input.indexOf('\\n')) >= 0) {
    const cmd = JSON.parse(input.slice(0, end));
    input = input.slice(end + 1);
    const reply = data => send({ type: 'response', id: cmd.id, command: cmd.type, success: true, data });
    if (cmd.type === 'get_state') {
      reply({ sessionId: 'pi-job', thinkingLevel: ${JSON.stringify(thinking)}, model: ${JSON.stringify(model)} });
    } else if (cmd.type === 'get_session_stats') {
      ${statsResponse};
    } else if (cmd.type === 'set_auto_retry' || cmd.type === 'set_auto_compaction') {
      reply();
    } else if (cmd.type === 'get_commands') {
      reply({ commands: [] });
    } else if (cmd.type === 'prompt') {
      reply({ disposition: 'started' });
      ${body}
    } else if (cmd.type === 'abort') {
      reply();
    }
  }
});
`;

for (const mode of ['completed', 'failed', 'interrupted', 'capture-only', 'storage-error']) {
  test(`background metrics record locally after ${mode}`, { timeout: 3000 }, async t => {
    const input = request(t), controller = new AbortController();
    const message = { role: 'assistant', provider: 'test', model: 'model', timestamp: 1, responseId: 'response-1',
      stopReason: 'stop', content: [{ type: 'text', text: 'Done' }], usage: { input: 2, output: 3 } };
    const program = rpc(`
      send({ type: 'message_end', message: ${JSON.stringify(message)} });
      send({ type: 'agent_end', messages: [${JSON.stringify(message)}] });
      ${mode === 'failed' ? 'process.exit(1);' : mode === 'interrupted' ? '' : "send({ type: 'agent_settled' });"}
    `);
    const metricsRoot = mode === 'capture-only' ? undefined : mode === 'storage-error' ? input.sessionFile : input.cwd;
    if (mode === 'storage-error') writeFileSync(metricsRoot, 'not a directory');
    const result = await runHarness({ ...input, signal: controller.signal }, { metricsRoot, spawnProcess: fake(program),
      onEvent: event => { if (mode === 'interrupted' && event.type === 'message_end') controller.abort(); } });
    assert.equal(result.status, ['failed', 'interrupted'].includes(mode) ? mode : 'completed');
    assert.equal(result.performance.responses, 1);
    assert.equal(result.performance.input.value, 2);
    const saved = readEvents(input.cwd).filter(event => event.type === 'run_performance');
    if (mode === 'capture-only' || mode === 'storage-error') assert.deepEqual(saved, []);
    else {
      assert.equal(saved.length, 1);
      const { at, type, steps, ...facts } = saved[0];
      assert.deepEqual(facts, result.performance);
      assert.equal(steps.length, 1);
      assert.equal(facts.runId, input.id);
      assert.equal(facts.sessionId, 'pi-job');
    }
  });
}

test('a turn times its process start and its first text from when the turn began', { timeout: 3000 }, async t => {
  const input = request(t);
  t.after(() => closeKept(input.sessionFile));
  const partial = { role: 'assistant', provider: 'test', model: 'model', timestamp: 1 };
  const message = { ...partial, responseId: 'response-1', stopReason: 'stop', content: [{ type: 'text', text: 'Done' }], usage: { input: 2, output: 3, cacheRead: 9 } };
  const program = rpc(`
    send({ type: 'agent_start' });
    send({ type: 'message_start', message: ${JSON.stringify(partial)} });
    send({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'hm' } });
    send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Done' } });
    send({ type: 'message_end', message: ${JSON.stringify(message)} });
    send({ type: 'agent_settled' });
  `);
  const since = Date.now() - 500;
  const result = await runHarness({ ...input, purpose: 'durable' }, { metricsRoot: input.cwd, spawnProcess: fake(program),
    turn: { since, origin: 'window', marks: { host: since + 20, admitted: since + 60 } } });
  assert.equal(result.status, 'completed');
  const { origin, kind, engine, model, effort, stages } = result.performance;
  assert.deepEqual([origin, kind, engine, model, effort], ['window', 'durable', 'pi', 'test/model', 'medium']);
  assert.deepEqual(Object.keys(stages), ['host', 'admitted', 'spawned', 'ready', 'prompted', 'started', 'requested', 'thinking', 'text', 'ended']);
  assert.deepEqual(Object.values(stages), Object.values(stages).toSorted((a, b) => a - b));
  assert.equal(stages.host, 20);
  assert.ok(stages.spawned >= 500);
  const [saved] = readEvents(input.cwd).filter(event => event.type === 'run_performance');
  assert.deepEqual(saved.steps.map(step => [step.input, step.cacheRead, step.output]), [[2, 9, 3]]);
  assert.ok(saved.steps[0].text >= saved.steps[0].at);

  // A run nobody sent counts from the moment hobkin started it.
  const alone = await runHarness({ ...input, id: 'f094b0ba-036c-4abc-9198-745fd1226766' }, { spawnProcess: fake(program) });
  assert.deepEqual([alone.performance.origin, alone.performance.kind], ['run', 'other']);
  assert.deepEqual(Object.keys(alone.performance.stages).slice(0, 3), ['spawned', 'ready', 'prompted']);
});

for (const disposition of ['started', 'queued', 'handled', undefined]) {
  test(`steering preserves the RPC disposition ${disposition} without inventing a receipt`, { timeout: 3000 }, async t => {
    const response = disposition ? { disposition } : undefined;
    const sent = Promise.withResolvers(), events = [];
    const program = rpc(`if (cmd.streamingBehavior) {
      if (${disposition !== 'handled'}) send({ type: 'message_end', message: { role: 'user', content: cmd.message } });
      send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Done' }] } });
      send({ type: 'agent_settled' });
    }`).replace("reply({ disposition: 'started' });", `reply(cmd.streamingBehavior ? ${JSON.stringify(response) ?? 'undefined'} : { disposition: 'started' });`);
    const result = await runHarness(request(t), { spawnProcess: fake(program), onEvent: event => events.push(event),
      onReady: send => { send('A note').then(sent.resolve, sent.reject); } });
    assert.equal(result.status, 'completed');
    assert.deepEqual(await sent.promise, response);
    assert.equal(events.some(event => event.type === 'message_end' && event.message?.content === 'A note'), disposition !== 'handled');
  });
}

test('harness argv keeps job identity controls and prompt text off the command line', t => {
  const pi = buildInvocation(request(t));
  assert.equal(pi.command, 'pi');
  assertOrdinaryPiDefaults(pi.args);
  assert.ok(!pi.args.includes('--model'));
  assert.equal(pi.args[pi.args.indexOf('--thinking') + 1], 'medium');
  assert.equal(pi.args[pi.args.indexOf('--mode') + 1], 'rpc');
  assert.ok(!pi.args.some(value => value.includes('quoted')));
  assert.throws(() => buildInvocation(request(t, 'claude')), /Pi/);
});

test('migrated delivery uses ordinary Pi defaults for compatibility checks', async t => {
  const input = { ...request(t), purpose: 'compatibility-check' };
  const invocation = buildInvocation(input);
  assertOrdinaryPiDefaults(invocation.args);
  assert.throws(() => buildInvocation({ ...input, harness: 'claude' }), /Pi/);
  const result = await runHarness(input, { spawnProcess: fake(rpc(`
    send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Ordinary report' }] } });
    send({ type: 'agent_settled' });
  `)) });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Ordinary report');
});

test('purpose-specific jobs keep their disabled tools and cannot change harness binding', t => {
  for (const purpose of ['migration-repair', 'reflection', 'session-patterns']) {
    const invocation = buildInvocation({ ...request(t), purpose });
    assert.ok(invocation.args.includes('--no-tools'));
    assert.ok(!invocation.args.includes('--tools'));
    assert.ok(invocation.args.includes('--no-extensions'));
    assert.ok(invocation.args.includes('--no-context-files'));
    assert.ok(invocation.args.includes('--no-approve'));
    assert.ok(invocation.args.includes('--system-prompt'));
    assert.throws(() => buildInvocation({ ...request(t, 'claude'), purpose }), /Pi/);
  }
  assert.throws(() => buildInvocation({ ...request(t), purpose: 'unknown' }), /purpose/);
});

test('Pi checks effective model and thinking before submission and returns session stats without counting streamed usage twice', async t => {
  const calls = [];
  const input = { ...request(t), model: 'test/model', effort: 'high' };
  const program = rpc(`
    send({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'stop',
        content: [{ type: 'text', text: 'Result \\u2028 Unicode' }],
        usage: { cost: { total: 0.25 } },
      },
    });
    send({ type: 'agent_end', messages: [] });
    send({ type: 'agent_settled' });
  `, 'high');
  const result = await runHarness(input, { spawnProcess: fake(program, calls) });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Result \u2028 Unicode');
  assert.deepEqual(result.cost, { usd: 0.25, kind: 'estimate', cumulative: true, sessionId: 'pi-job' });
  assert.equal(result.tokens, 15);
  assert.equal(result.model, 'test/model');
  assert.equal(result.effort, 'high');
  assert.equal(result.freshSession, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.shell, false);
  assertOrdinaryPiDefaults(calls[0].args);
  assert.equal(calls[0].args[calls[0].args.indexOf('--model') + 1], 'test/model');
  assert.equal(calls[0].args[calls[0].args.indexOf('--thinking') + 1], 'high');
});

const metricMessage = (timestamp, extra = {}) => ({ role: 'assistant', provider: 'test', model: 'model', timestamp,
  stopReason: 'stop', content: [{ type: 'text', text: 'PRIVATE answer' }], durationMs: 12,
  usage: { input: 10, output: 5, cacheRead: 20, cacheWrite: 2, cost: { total: 0.1 } }, ...extra });

test('background telemetry captures native session and deduplicates multiple responses without changing cumulative billing', { timeout: 3000 }, async t => {
  const one = metricMessage(1), two = metricMessage(2);
  const events = [
    { type: 'message_start', message: one },
    { type: 'message_update', usage: one.usage, assistantMessageEvent: { type: 'text_delta', delta: 'PRIVATE delta' } },
    { type: 'message_end', message: one }, { type: 'message_end', message: structuredClone(one) },
    { type: 'turn_end', message: one }, { type: 'agent_end', messages: [one] },
    { type: 'message_start', message: two }, { type: 'message_end', message: two },
    { type: 'agent_settled' },
  ];
  const seen = [];
  const result = await runHarness({ ...request(t), purpose: 'work-do' }, {
    spawnProcess: fake(rpc(events.map(event => `send(${JSON.stringify(event)});`).join('\n'))),
    onEvent: event => seen.push(event),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.performance.runId, id);
  assert.equal(result.performance.sessionId, 'pi-job');
  assert.equal(result.performance.responses, 2);
  assert.deepEqual(result.performance.input, { value: 20, state: 'complete' });
  assert.deepEqual(result.performance.cacheRead, { value: 40, state: 'complete' });
  assert.deepEqual(result.performance.estimatedUsd, { value: 0.2, state: 'complete' });
  assert.equal(result.performance.responseDurationMs.value, 24);
  assert.ok(result.performance.firstObservedOutputMs >= 0);
  assert.ok(result.performance.dispatchElapsedMs >= result.performance.firstObservedOutputMs);
  assert.equal(result.tokens, 15);
  assert.equal(result.cost.usd, 0.25);
  assert.equal(result.cost.cumulative, true);
  assert.equal(seen.find(event => event.type === 'message_update').message, undefined);
  assert.ok(Object.isFrozen(result.performance));
  assert.doesNotMatch(JSON.stringify(result.performance), /PRIVATE|content|provider|responseId/);
});

for (const ending of ['abort', 'exit', 'no-usage']) {
  test(`background telemetry retains honest ${ending} facts`, { timeout: 3000 }, async t => {
    const one = metricMessage(1), two = metricMessage(2, { usage: undefined });
    const events = [ { type: 'message_end', message: one }, { type: 'message_start', message: two } ];
    const finish = ending === 'exit' ? 'process.exit(2);' : ending === 'abort'
      ? "send({ type: 'agent_settled', aborted: true });"
      : `send(${JSON.stringify({ type: 'message_end', message: two })}); send({ type: 'agent_settled' });`;
    const result = await runHarness(request(t), { spawnProcess: fake(rpc(events.map(event => `send(${JSON.stringify(event)});`).join('\n') + finish)) });
    assert.equal(result.status, ending === 'abort' ? 'interrupted' : ending === 'exit' ? 'failed' : 'completed');
    assert.deepEqual(result.performance.input, { value: 10, state: 'partial' });
    assert.equal(result.performance.incomplete, ending !== 'no-usage');
    assert.equal(result.performance.responses, ending === 'no-usage' ? 2 : 1);
  });
}

test('background telemetry isolates child ownership and leaves missing usage unavailable', { timeout: 3000 }, async t => {
  const first = metricMessage(1);
  const second = metricMessage(2, { usage: undefined, durationMs: undefined });
  const run = (sessionId, message) => runHarness(request(t), { spawnProcess: fake(rpc(`
    send(${JSON.stringify({ type: 'message_start', message })});
    send({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: ' ' } });
    send(${JSON.stringify({ type: 'message_end', message })});
    send({ type: 'agent_settled' });
  `).replaceAll('pi-job', sessionId)) });
  const a = await run('native-one', first);
  const b = await run('native-two', second);
  assert.equal(a.performance.sessionId, 'native-one');
  assert.equal(b.performance.sessionId, 'native-two');
  assert.equal(a.performance.input.value, 10);
  assert.deepEqual(b.performance.input, { value: null, state: 'unavailable' });
  assert.deepEqual(b.performance.estimatedUsd, { value: null, state: 'unavailable' });
  assert.equal(b.performance.responses, 1);
  assert.ok(b.performance.firstObservedOutputMs >= 0);
  assert.equal(b.performance.incomplete, false);
});

test('background telemetry has no invented native identity before dispatch', { timeout: 3000 }, async t => {
  const result = await runHarness(request(t), { spawnProcess: fake(rpc('', 'low')) });
  assert.equal(result.status, 'failed');
  assert.equal(result.performance, undefined);
});

const teamEvents = `
  const say = text => send({
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] },
  });
  const started = (toolName, details, isError = false) => send({
    type: 'tool_execution_end',
    toolName,
    isError,
    result: { content: [], details },
  });
  const delivered = (customType, details) => send({
    type: 'message_end',
    message: { role: 'custom', customType, content: 'Agent result.', display: false, details },
  });
  const settled = () => send({ type: 'agent_settled' });
  const later = step => setTimeout(step, 20);
`;

test('a job waits for a spawned agent report instead of saving the interim reply', async t => {
  const program = rpc(`${teamEvents}
    started('spawn_agent', { name: 'reader' });
    say('The check is underway.');
    settled();
    later(() => {
      delivered('pi-extended-teams-report', { name: 'reader', ok: true });
      say('Useful: final report.');
      settled();
    });
  `);

  const result = await runHarness(request(t), { spawnProcess: fake(program) });

  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Useful: final report.');
});

test('a job stays alive until every spawned agent has reported', async t => {
  const program = rpc(`${teamEvents}
    started('spawn_swarm_agents', { spawned: [{ name: 'one' }, { name: 'two' }], failed: [] });
    say('Both are running.');
    settled();
    later(() => {
      delivered('pi-extended-teams-report', { name: 'one', ok: true });
      say('Still waiting for two.');
      settled();
      later(() => {
        delivered('pi-extended-teams-report', { name: 'two', ok: false });
        say('Useful: both reported.');
        settled();
      });
    });
  `);

  const result = await runHarness(request(t), { spawnProcess: fake(program) });

  assert.equal(result.text, 'Useful: both reported.');
});

test('a grouped swarm finishes on its group wake because member reports are suppressed', { timeout: 3000 }, async t => {
  const program = rpc(`${teamEvents}
    started('spawn_swarm_agents', {
      spawned: [{ name: 'one' }, { name: 'two' }],
      failed: [],
      completionGroup: { groupId: 'group-1' },
    });
    say('The group is running.');
    settled();
    later(() => {
      delivered('pi-extended-teams-wake');
      say('Useful: group finished.');
      settled();
    });
  `);

  const result = await runHarness(request(t), { spawnProcess: fake(program) });

  assert.equal(result.text, 'Useful: group finished.');
});

test('a failed spawn leaves nothing to wait for', { timeout: 3000 }, async t => {
  const program = rpc(`${teamEvents}
    started('spawn_agent', undefined, true);
    say('Useful: the agent could not start.');
    settled();
  `);

  const result = await runHarness(request(t), { spawnProcess: fake(program) });

  assert.equal(result.text, 'Useful: the agent could not start.');
});

test('a running job takes a message as a steer, until the run is over', async t => {
  const program = rpc(`${teamEvents}
    if (cmd.streamingBehavior === 'steer') {
      say('Took: ' + cmd.message);
      settled();
    }
  `);
  let message;

  const result = await runHarness(request(t), {
    spawnProcess: fake(program),
    onReady: send => {
      message = send;
      void send('look at the invoices');
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Took: look at the invoices');
  await assert.rejects(message('too late'), /has finished/);
});

test('an extension error is noted in the report and does not end a healthy run', async t => {
  const result = await runHarness(request(t), { spawnProcess: fake(rpc(`
    send({ type: 'extension_error', extensionPath: '/extensions/example.ts', event: 'agent_end', error: 'handler failed' });
    send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Useful: The answer.' }] } });
    send({ type: 'agent_settled' });
  `)) });

  assert.equal(result.status, 'completed');
  assert.match(result.text, /^Useful: The answer\./);
  assert.match(result.text, /\/extensions\/example\.ts \(agent_end\): handler failed/);
});

test('an aborted run stays interrupted even after an extension error', async t => {
  const result = await runHarness(request(t), { spawnProcess: fake(rpc(`
    send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Answer retained' }] } });
    send({ type: 'extension_error', extensionPath: '/extensions/example.ts', event: 'agent_end', error: 'handler failed' });
    send({ type: 'agent_settled', aborted: true });
  `)) });

  assert.equal(result.status, 'interrupted');
  assert.equal(result.text, 'Answer retained');
});

test('Pi RPC aborted settlement without an extension error is interrupted, not completed', async t => {
  const result = await runHarness(request(t), { spawnProcess: fake(rpc(`
    send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Answer retained' }] } });
    send({ type: 'agent_settled', aborted: true });
  `)) });
  assert.equal(result.status, 'interrupted');
  assert.equal(result.text, 'Answer retained');
  assert.match(result.error, /abort/i);
});

test('Pi keeps a completed answer when optional session statistics are rejected', async t => {
  const result = await runHarness(request(t), { spawnProcess: fake(rpc(`
    send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Answer retained' }] } });
    send({ type: 'agent_settled' });
  `, 'medium', undefined, "send({ type: 'response', id: cmd.id, success: false, error: 'Statistics unavailable' })")) });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Answer retained');
  assert.equal(result.cost, null);
});

test('Pi still rejects session statistics attributed to a different session', async t => {
  const result = await runHarness(request(t), { spawnProcess: fake(rpc(`
    send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Answer retained' }] } });
    send({ type: 'agent_settled' });
  `, 'medium', undefined, "reply({ sessionId: 'other-session', cost: 0.25 })")) });
  assert.equal(result.status, 'failed');
  assert.equal(result.text, 'Answer retained');
  assert.equal(result.cost, null);
  assert.match(result.error, /identity/);
});

test('a check trusts its own folder, so it has everything the user has', t => {
  assert.equal(buildInvocation(request(t)).args.includes('--approve'), true);
});

test('a work run keeps normal Pi permissions, tools and both sets of directions', async t => {
  for (const [purpose, heading] of [['work-discover', /find the user's projects/], ['work-look', /look at a project/], ['work-do', /finish one item/]]) {
    const input = { ...request(t), purpose };
    const { args } = buildInvocation(input);

    assertOrdinaryPiDefaults(args);
    const systemPrompts = args.flatMap((arg, index) => arg === '--append-system-prompt' ? [args[index + 1]] : []);
    assert.deepEqual(args, [
      '--mode', 'rpc', '--session', input.sessionFile, '--thinking', 'medium',
      '--append-system-prompt', systemPrompts[0], '--append-system-prompt', systemPrompts[1],
    ]);
    const launcher = { command: ['fixture-pi', '--no-approve'] };
    const configured = buildInvocation({ ...input, launcher, extensions: ['/fixture/teams.ts'] });
    assert.equal(configured.command, 'fixture-pi');
    assert.deepEqual(configured.args, [
      '--no-approve', ...args.slice(0, 6), '--no-extensions', '--extension', '/fixture/teams.ts', ...args.slice(6),
    ]);
    const calls = [];
    const result = await runHarness({ ...input, launcher, extensions: ['/fixture/teams.ts'] }, { spawnProcess: fake(rpc(`
      send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Useful: Done.' }] } });
      send({ type: 'agent_settled' });
    `), calls) });
    assert.equal(result.status, 'completed');
    assert.deepEqual([calls[0].command, calls[0].args], [configured.command, configured.args]);
    const appended = systemPrompts;
    assert.equal(appended.length, 2);
    assert.match(appended[0], /Hobkin background check/);
    assert.match(appended[1], heading);
  }
});

test('a work run accepts the level Pi clamps to, because the top level differs by model', async t => {
  const finish = `
    send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Useful: Done.' }], usage: { cost: { total: 0 } } } });
    send({ type: 'agent_end', messages: [] });
    send({ type: 'agent_settled' });
  `;
  const model = { provider: 'test', id: 'model', reasoning: true };

  const clamped = await runHarness(
    { ...request(t), purpose: 'work-do', effort: 'xhigh' },
    { spawnProcess: fake(rpc(finish, 'high', model)) },
  );
  assert.equal(clamped.status, 'completed');

  const changed = await runHarness(
    { ...request(t), purpose: 'work-do', effort: 'xhigh' },
    { spawnProcess: fake(rpc(finish, 'low', model)) },
  );
  assert.equal(changed.status, 'failed');
  assert.match(changed.error, /effort/);
});

test('a clamped Pi effort fails before any prompt is submitted', async t => {
  const result = await runHarness(request(t), { spawnProcess: fake(rpc("process.stderr.write('PROMPT_WAS_SENT');", 'low')) });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /effort/);
  assert.doesNotMatch(result.error, /PROMPT_WAS_SENT/);
});

test('a mismatched Pi model fails before any prompt is submitted', async t => {
  const input = { ...request(t), model: 'test/requested' };
  const result = await runHarness(input, {
    spawnProcess: fake(rpc(
      "process.stderr.write('PROMPT_WAS_SENT');",
      'medium',
      { provider: 'test', id: 'effective' },
    )),
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /model/);
  assert.doesNotMatch(result.error, /PROMPT_WAS_SENT/);
});

test('Pi handled prompts fail without waiting for settlement and reap the owned child', { timeout: 3000 }, async t => {
  let child;
  t.after(() => { if (child?.exitCode === null && child?.signalCode === null) child.kill('SIGKILL'); });
  const result = await runHarness(request(t), {
    spawnProcess: (...args) => {
      child = fake(rpc('').replace("reply({ disposition: 'started' });", "reply({ disposition: 'handled' });"))(...args);
      return child;
    },
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /Pi handled the prompt without starting an assistant response/);
  assert.equal(result.text, '');
  assert.equal(result.cost, null);
  assert.equal(result.noModel, undefined);
  assert.notEqual(child.signalCode ?? child.exitCode, null);
});

test('Pi accepts older prompt replies without a disposition', async t => {
  const result = await runHarness(request(t), { spawnProcess: fake(rpc(`
    send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Older reply' }] } });
    send({ type: 'agent_settled' });
  `).replace("reply({ disposition: 'started' });", "reply();")) });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Older reply');
});

test('missing, malformed, failed or oversized results never become zero-cost success', async t => {
  const failures = [
    "process.exit(0)",
    "console.log('{broken')",
    "process.stderr.write('denied');process.exit(2)",
    rpc("send({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', content: [] } }); send({ type: 'agent_settled' });"),
    "console.log('x'.repeat(1025))",
  ];
  for (const program of failures) {
    const result = await runHarness(request(t), { spawnProcess: fake(program), maxOutputBytes: 1024 });
    assert.equal(result.status, 'failed');
    assert.equal(result.cost, null);
    assert.ok(result.error);
  }
});

test('the output byte bound applies to each LF-delimited record, not to a long healthy stream', async t => {
  const longStream = fake(rpc(`
    for (let index = 0; index < 64; index++) {
      send({
        type: 'message_update',
        usage: { output: index },
        assistantMessageEvent: { type: 'text_delta', delta: 'x'.repeat(64) },
      });
    }
    send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Long report' }] } });
    send({ type: 'agent_settled' });
  `));
  const splitOversizedRecord = fake(rpc(`
    const record = JSON.stringify({ type: 'tool_execution_end', result: 'x'.repeat(1100) }) + '\\n';
    process.stdout.write(record.slice(0, 600));
    setTimeout(() => process.stdout.write(record.slice(600)), 20);
  `));

  const completed = await runHarness(request(t), { spawnProcess: longStream, maxOutputBytes: 1024 });
  const rejected = await runHarness(request(t), { spawnProcess: splitOversizedRecord, maxOutputBytes: 1024 });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.text, 'Long report');
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.cost, null);
  assert.match(rejected.error, /record exceeded its byte limit/);
});

test('cancellation terminates the owned child and leaves unknown cost, without retry', async t => {
  const aborted = new AbortController();
  const calls = [];
  const result = await runHarness({ ...request(t), signal: aborted.signal }, {
    spawnProcess: fake("console.log(JSON.stringify({type:'system'}));setInterval(()=>{},1000)", calls),
    onEvent: () => aborted.abort(),
  });
  assert.equal(result.status, 'interrupted');
  assert.equal(result.cost, null);
  assert.equal(calls.length, 1);
});

test('a Pi job slower than an inherited saved timeout finishes naturally', async t => {
  const result = await runHarness({ ...request(t), timeoutMs: 20 }, { spawnProcess: fake(rpc(`
    setTimeout(() => {
      send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Slow report' }] } });
      send({ type: 'agent_settled' });
    }, 200);
  `)) });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Slow report');
});

test('a job with tools loads exactly the extensions it was given', t => {
  const { args } = buildInvocation({ ...request(t), extensions: ['/chrome/index.ts', 'builtin:mcp'] });

  assert.ok(args.includes('--no-extensions'));
  assert.deepEqual(args.filter((_arg, index) => args[index - 1] === '--extension'), ['/chrome/index.ts', 'builtin:mcp']);
  assert.ok(args.includes('--approve'), 'it keeps its permissions');
});

test('a job given no list leaves extensions to Pi', t => {
  assert.ok(!buildInvocation(request(t)).args.includes('--no-extensions'));
});

test('every job that loads tools leaves pi-emote behind, and the user\'s Pi settings are only read', async t => {
  const agentDir = mkdtempSync(join(tmpdir(), 'hobkin-agent-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  });
  mkdirSync(join(agentDir, 'extensions/pi-emote'), { recursive: true });
  writeFileSync(join(agentDir, 'extensions/pi-emote/index.ts'), 'export default function () {}\n');
  writeFileSync(join(agentDir, 'extensions/own.ts'), 'export default function () {}\n');
  const started = [], given = [];
  const run = namingExtensions(async (job, options) => { started.push(job); given.push(options); });

  await run(request(t));
  await run({ ...request(t), purpose: 'work-do' }, { metricsRoot: '/kept', turn: { since: 5, origin: 'window', marks: { host: 6 } } });
  await run({ ...request(t), purpose: 'reflection' });

  // Naming them takes time before the process starts, so the turn is told when it was done.
  const [alone, timed, untouched] = given;
  assert.equal(alone.turn.origin, 'run');
  assert.ok(alone.turn.marks.resolved >= alone.turn.since);
  assert.deepEqual([timed.metricsRoot, timed.turn.since, timed.turn.origin, timed.turn.marks.host], ['/kept', 5, 'window', 6]);
  assert.ok(timed.turn.marks.resolved > 6);
  assert.equal(untouched, undefined);

  const [check, work, toolFree] = started;
  for (const job of [check, work]) {
    assert.ok(job.extensions.includes(join(agentDir, 'extensions/own.ts')));
    assert.deepEqual(job.extensions.filter(path => path.includes('pi-emote')), []);
  }
  assert.equal(toolFree.extensions, undefined, 'a tool-free job already loads no extensions');
});

test('the main chat leaves out the packages that would stop its compaction, keep a second memory or speak as the user, and other runs keep them', async t => {
  const agentDir = mkdtempSync(join(tmpdir(), 'hobkin-agent-'));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  for (const name of ['pi-memory', 'pi-cache-compact-preserved-messages', 'pi-scheduler', 'pi-other']) {
    mkdirSync(join(agentDir, 'extensions', name), { recursive: true });
    writeFileSync(join(agentDir, 'extensions', name, 'index.ts'), 'export default function () {}\n');
  }
  const named = paths => paths.map(path => path.split('/').at(-2)).toSorted();

  const mainChat = await extensionPaths(agentDir, { agentDir, builtIns: [], leaveOut: LEFT_OUT_OF_THE_MAIN_CHAT });
  const otherRun = await extensionPaths(agentDir, { agentDir, builtIns: [] });

  assert.deepEqual(named(mainChat), ['pi-other']);
  assert.deepEqual(named(otherRun), ['pi-cache-compact-preserved-messages', 'pi-memory', 'pi-other', 'pi-scheduler']);
});

// A Pi that stays up for every prompt it is sent and reports the model and thinking it was started with. It answers
// each prompt at once, except one that says "Hold on.", and a prompt that says "Fail." ends without a stop.
const keptPi = `
const args = process.argv.slice(1);
const flag = name => args[args.indexOf(name) + 1];
const [provider, model] = (args.includes('--model') ? flag('--model') : 'test/model').split('/');
const send = event => process.stdout.write(JSON.stringify(event) + '\\n');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  let end;
  while ((end = input.indexOf('\\n')) >= 0) {
    const cmd = JSON.parse(input.slice(0, end));
    input = input.slice(end + 1);
    const reply = data => send({ type: 'response', id: cmd.id, command: cmd.type, success: true, data });
    if (cmd.type === 'get_state') reply({ sessionId: 'pi-kept', thinkingLevel: flag('--thinking'), model: { provider, id: model } });
    else if (cmd.type === 'get_session_stats') reply({ sessionId: 'pi-kept', cost: 0.1 });
    else if (cmd.type === 'prompt') {
      reply({ disposition: 'started' });
      if (cmd.message === 'Hold on.') continue;
      send({ type: 'message_end', message: { role: 'assistant', provider: 'test', model: 'model', timestamp: Date.now(),
        stopReason: cmd.message === 'Fail.' ? 'error' : 'stop', content: [{ type: 'text', text: 'Took: ' + cmd.message }] } });
      send({ type: 'agent_settled' });
    }
  }
});
`;

/** Every Pi process the runs start, each with the commands hobkin sent it, in order. */
function keptPis() {
  const processes = [];
  const spawnProcess = (command, args, options) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', keptPi, '--', ...args], options);
    processes.push({ child, commands: [] });
    return child;
  };
  const startProcess = options => {
    const rpc = startRpcProcess(options);
    const { commands } = processes.at(-1);
    return Object.assign(Object.create(rpc), { request: (type, ...rest) => { commands.push(type); return rpc.request(type, ...rest); } });
  };
  return { processes, options: { spawnProcess, startProcess } };
}

const gone = child => child.exitCode !== null || child.signalCode !== null;
const ended = child => new Promise(resolve => (gone(child) ? resolve() : child.once('exit', resolve)));
const turnId = n => `f094b0ba-036c-4abc-9198-${String(n).padStart(12, '0')}`;
const durableTurn = (t, extra = {}) => {
  const input = { ...request(t), purpose: 'durable', ...extra };
  t.after(() => closeKept(input.sessionFile));
  return input;
};
const texts = events => events.filter(event => event.type === 'message_end').map(event => event.message.content[0].text);

test("a durable turn leaves its process up, and the conversation's next turn only prompts it", { timeout: 5000 }, async t => {
  const { processes, options } = keptPis();
  const input = durableTurn(t);
  const seen = [[], []];
  const first = await runHarness({ ...input, id: turnId(1), prompt: 'First.' }, { ...options, onEvent: event => seen[0].push(event), turn: { since: Date.now(), marks: {} } });
  assert.equal(first.status, 'completed');
  assert.equal(gone(processes[0].child), false, 'the process waits for the next turn');

  const second = await runHarness({ ...input, id: turnId(2), prompt: 'Second.' }, { ...options, onEvent: event => seen[1].push(event), turn: { since: Date.now(), marks: {} } });
  assert.equal(second.status, 'completed');
  assert.equal(processes.length, 1);
  assert.deepEqual(processes[0].commands, ['get_state', 'prompt', 'get_session_stats', 'prompt', 'get_session_stats']);
  assert.deepEqual([second.text, second.sessionId, second.model, second.cost.usd], ['Took: Second.', 'pi-kept', 'test/model', 0.1]);
  assert.deepEqual(Object.keys(second).toSorted(), Object.keys(first).toSorted());
  // With no process to start, the turn has no stage for one.
  assert.ok(first.performance.stages.spawned >= 0 && first.performance.stages.ready >= 0);
  assert.deepEqual(['spawned', 'ready'].filter(stage => stage in second.performance.stages), []);
  assert.ok(second.performance.stages.prompted >= 0);
  assert.deepEqual(texts(seen[0]), ['Took: First.'], "the second turn's records reach only its own handlers");
  assert.deepEqual(texts(seen[1]), ['Took: Second.']);
});

test('a durable turn started any other way closes the kept process and starts its own', { timeout: 10000 }, async t => {
  const otherCwd = mkdtempSync(join(tmpdir(), 'hobkin-harness-'));
  t.after(() => rmSync(otherCwd, { recursive: true, force: true }));
  const changes = { model: { model: 'test/other' }, effort: { effort: 'high' }, directions: { directions: 'Be thorough.' },
    extensions: { extensions: ['/fixture/b.ts'] }, environment: { env: { HOBKIN_TURN: 'b'.repeat(32) } }, folder: { cwd: otherCwd } };
  for (const [name, change] of Object.entries(changes)) {
    const { processes, options } = keptPis();
    const input = durableTurn(t, { model: 'test/model', directions: 'Be brief.', extensions: ['/fixture/a.ts'], env: { HOBKIN_TURN: 'a'.repeat(32) } });
    assert.equal((await runHarness({ ...input, id: turnId(1) }, options)).status, 'completed', name);
    const changed = await runHarness({ ...input, ...change, id: turnId(2) }, options);
    assert.equal(changed.status, 'completed', name);
    assert.equal(processes.length, 2, `a changed ${name} starts a new process`);
    assert.ok(gone(processes[0].child), `and the one kept with the old ${name} is closed`);
    assert.deepEqual(processes[1].commands, ['get_state', 'prompt', 'get_session_stats']);
  }
});

test('a kept process that is replaced says which of the things it was started with differed, by name and never by value', { timeout: 10000 }, async t => {
  const { options } = keptPis();
  const input = durableTurn(t, { model: 'test/model', directions: 'PRIVATE directions.', extensions: ['/fixture/a.ts'], env: { HOBKIN_TURN: 'a'.repeat(32) } });
  const replaced = () => readEvents(input.cwd).filter(event => event.type === 'kept_process_replaced');
  await runHarness({ ...input, id: turnId(1) }, { ...options, metricsRoot: input.cwd });
  await runHarness({ ...input, id: turnId(2) }, { ...options, metricsRoot: input.cwd });
  assert.deepEqual(replaced(), [], 'a turn that reuses the process says nothing');
  await runHarness({ ...input, id: turnId(3), effort: 'high', directions: 'PRIVATE other directions.', env: { HOBKIN_TURN: 'b'.repeat(32), HOBKIN_NEW: '1' } }, { ...options, metricsRoot: input.cwd });
  const [{ at, type, ...facts }] = replaced();
  assert.deepEqual(facts, { id: turnId(3), command: false, cwd: false, args: ['--thinking', '--append-system-prompt'], env: ['HOBKIN_NEW', 'HOBKIN_TURN'] });
  assert.doesNotMatch(JSON.stringify(facts), /PRIVATE|bbbb|aaaa|fixture/);
  await closeKept(input.sessionFile);
});

test('a kept process goes after its idle time, and past four kept the one idle longest goes', { timeout: 10000 }, async t => {
  const idle = keptPis();
  const input = durableTurn(t);
  await runHarness({ ...input, id: turnId(1) }, { ...idle.options, keepIdleMs: 50 });
  await ended(idle.processes[0].child);
  assert.equal((await runHarness({ ...input, id: turnId(2) }, idle.options)).status, 'completed');
  assert.equal(idle.processes.length, 2, 'the next turn starts a process of its own');

  const many = keptPis();
  const inputs = Array.from({ length: 5 }, () => durableTurn(t));
  for (const [n, input] of inputs.entries()) await runHarness({ ...input, id: turnId(10 + n) }, many.options);
  // The first one kept goes, and a new process for its conversation starts only once that one has exited.
  const oldGone = [];
  const watching = { ...many.options, spawnProcess: (...args) => { oldGone.push(gone(many.processes[0].child)); return many.options.spawnProcess(...args); } };
  assert.equal((await runHarness({ ...inputs[0], id: turnId(20) }, watching)).status, 'completed');
  assert.deepEqual(oldGone, [true]);
  // Keeping that one makes five again, so the one now idle longest goes.
  await ended(many.processes[1].child);
  assert.deepEqual(many.processes.map(({ child }) => gone(child)), [true, true, false, false, false, false]);
});

test('a failed or stopped turn closes its process, and one that exits between turns is replaced', { timeout: 10000 }, async t => {
  for (const ending of ['failed', 'stopped', 'forced']) {
    const { processes, options } = keptPis();
    const input = durableTurn(t);
    await runHarness({ ...input, id: turnId(1) }, options);
    const controller = new AbortController();
    const result = await runHarness({ ...input, id: turnId(2), prompt: ending === 'failed' ? 'Fail.' : 'Hold on.', signal: controller.signal }, {
      ...options,
      onControl: handle => { if (ending === 'forced') queueMicrotask(() => handle.force()); },
      onReady: () => { if (ending === 'stopped') controller.abort(); },
    });
    assert.equal(result.status, ending === 'failed' ? 'failed' : 'interrupted', ending);
    assert.equal(processes.length, 1, `the ${ending} turn ran on the kept process`);
    assert.ok(gone(processes[0].child), `and a ${ending} turn closes it`);
    assert.equal((await runHarness({ ...input, id: turnId(3) }, options)).status, 'completed');
    assert.equal(processes.length, 2);
  }

  const { processes, options } = keptPis();
  const input = durableTurn(t);
  await runHarness({ ...input, id: turnId(1) }, options);
  processes[0].child.kill('SIGKILL');
  await ended(processes[0].child);
  const replaced = await runHarness({ ...input, id: turnId(2), prompt: 'Again.' }, options);
  assert.deepEqual([replaced.status, replaced.text, processes.length], ['completed', 'Took: Again.', 2]);
});

test("Stop and Force reach only the turn in flight, and a turn never takes a process another turn holds", { timeout: 5000 }, async t => {
  const { processes, options } = keptPis();
  const input = durableTurn(t);
  const handles = [];
  const onControl = handle => handles.push(handle);
  await runHarness({ ...input, id: turnId(1) }, { ...options, onControl });
  // The first turn's handle says it is closed once that turn ends, and forcing it then reaches nothing.
  await handles[0].closed;
  handles[0].force();

  const holding = runHarness({ ...input, id: turnId(2), prompt: 'Hold on.' }, { ...options, onControl });
  await new Promise(resolve => setTimeout(resolve, 100));
  const alongside = await runHarness({ ...input, id: turnId(3), prompt: 'Meanwhile.' }, { ...options, onControl });
  assert.equal(alongside.status, 'completed');
  assert.equal(processes.length, 2, 'the held process was not handed to another turn');

  handles[1].force();
  assert.equal((await holding).status, 'interrupted');
  assert.ok(gone(processes[0].child));
  assert.equal(gone(processes[1].child), false, "Force on the second turn left the third turn's process alone");
});

test('a conversation closes its kept process on request, and other runs end theirs each time', { timeout: 5000 }, async t => {
  const durable = keptPis();
  const input = durableTurn(t);
  await runHarness({ ...input, id: turnId(1) }, durable.options);
  await closeKept(input.sessionFile);
  assert.ok(gone(durable.processes[0].child));
  await runHarness({ ...input, id: turnId(2) }, durable.options);
  assert.equal(durable.processes.length, 2);

  for (const purpose of [undefined, 'work-do']) {
    const other = keptPis();
    const job = { ...request(t), ...(purpose ? { purpose } : {}) };
    await runHarness({ ...job, id: turnId(1) }, other.options);
    assert.ok(gone(other.processes[0].child), `a ${purpose ?? 'check'} run ends its process`);
    await runHarness({ ...job, id: turnId(2) }, other.options);
    assert.equal(other.processes.length, 2);
  }
});

test("a tool-using run records what its first model request was made of, as hashes and sizes and never the text", { timeout: 3000 }, async t => {
  const input = { ...request(t), purpose: 'work-do' };
  const status = statusText => ({ type: 'extension_ui_request', id: 'status', method: 'setStatus', statusKey: 'hobkin/prompt', statusText });
  const first = { parts: { instructions: '0123456789ab', tools: 'ba9876543210' }, sizes: { instructions: 41250, tools: 98000, toolCount: 31 } };
  const records = [
    status(JSON.stringify({ parts: { instructions: 'You are hobkin, PRIVATE', tools: 'x' }, sizes: { instructions: 1, tools: 1, toolCount: 1 } })),
    status(JSON.stringify(first)),
    status(JSON.stringify({ parts: { instructions: 'ffffffffffff', tools: 'eeeeeeeeeeee' }, sizes: { instructions: 1, tools: 1, toolCount: 1 } })),
    { type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Useful: Done.' }] } },
    { type: 'agent_settled' },
  ];
  const result = await runHarness(input, { metricsRoot: input.cwd, spawnProcess: fake(rpc(records.map(record => `send(${JSON.stringify(record)});`).join('\n'))) });
  assert.equal(result.status, 'completed');
  const saved = readEvents(input.cwd).filter(event => event.type === 'turn_prompt');
  assert.deepEqual(saved.map(({ at, ...facts }) => facts), [{ type: 'turn_prompt', id, ...first }]);
  assert.doesNotMatch(JSON.stringify(readEvents(input.cwd)), /PRIVATE/);
});
