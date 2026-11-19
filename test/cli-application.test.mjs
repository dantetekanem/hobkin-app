import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { mock } from 'node:test';
if (process.env.HOBKIN_ACTIVITY_TEST_ONLY === '1') {
  const forbidden = () => { throw Error('Activity fixture forbids SDK/resources/process/network/signals'); };
  for (const key of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) mock.method(childProcess, key, forbidden);
  mock.method(process, 'kill', forbidden);
  mock.method(globalThis, 'fetch', forbidden);
  syncBuiltinESMExports();
  const sdk = 'data:text/javascript,' + encodeURIComponent(`
    export const defineTool = tool => tool;
    const no = () => { throw Error('SDK/resources forbidden'); };
    export {
      no as createAgentSession, no as DefaultResourceLoader, no as SessionManager,
      no as ModelRuntime, no as SettingsManager, no as getAgentDir,
      no as getMarkdownTheme, no as getSelectListTheme, no as initTheme,
    };
  `);
  registerHooks({ resolve(specifier, context, next) { return specifier === '@earendil-works/pi-coding-agent' ? { url: sdk, shortCircuit: true } : next(specifier, context); } });
}
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { initialize, atomicJson, loadConfig, setLearning } = await import('../src/cli/config.mjs');
const { HobkinApplication, readLocalView } = await import('../src/cli/application.mjs');
const { HobkinRuntime, IMAGE_ROOM_BYTES, MAIN_BUSY } = await import('../src/cli/runtime.mjs');
const { MAX_SESSION_BYTES } = await import('../src/cli/migration/ownership.mjs');
const { deleteReports, saveReport } = await import('../src/cli/reports.mjs');
const { readPresentationState, savePresentationState } = await import('../src/cli/view.mjs');
const { fakePi } = await import('./helpers/pi-session.mjs');
import { png } from './helpers/png.mjs';
const { fileActionItem, fileDecision, markShown, openDecisions } = await import('../src/cli/decisions.mjs');
const { readBriefState, writeBriefState } = await import('../src/cli/brief.mjs');
const { openCheck } = await import('../src/cli/checks.mjs');
const { retireOffers } = await import('../src/cli/work/land-offer.mjs');
const { chooseProject, fileItem, readItems, readProject, updateItem, writeMode } = await import('../src/cli/work/store.mjs');
const { branched, git, repository } = await import('./helpers/work-fixture.mjs');
const { createDashboard } = await import('../src/cli/ui.mjs');
const { readActions, saveState } = await import('../src/cli/learning/store.mjs');
const { startSession } = await import('../src/cli/session.mjs');
const { recordSessionEnd, recordSessionStart, sessionsToPost, sessionsToWake } = await import('../src/cli/session-log.mjs');
const { allCardActions, cardActionsToTell, markCardActionsHeard } = await import('../src/cli/work/card-actions.mjs');
const { listTemplates } = await import('../src/cli/routine-templates.mjs');
const { stripTerminalSequences } = await import('@earendil-works/pi-tui');

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-app-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const fake = fakePi(root);
  return {
    root, config, fake,
    openApp: (options = {}) => HobkinApplication.open(root, { createMain: fake.createMain, ...options }),
  };
}

for (const launcher of [undefined, { command: ['fixture-pi'], managedExtensions: true }])
test(`application forwards its trusted metrics root through routine, session and Work harnesses (launcher: ${Boolean(launcher)})`, async t => {
  const h = fixture(t);
  if (launcher) atomicJson(join(h.root, 'config.json'), { ...h.config, launcher });
  const calls = [];
  const app = await h.openApp({ intervalMs: 60000,
    createMain: options => h.fake.createMain({ ...options, config: { ...options.config, launcher: undefined } }),
    runHarness: async (request, options) => { calls.push({ request, options }); return request; } });
  t.after(() => app.close());
  const request = { id: 'fixture', metricsRoot: '/untrusted-request', sessionFile: '/untrusted/session.jsonl' };
  const options = { metricsRoot: '/untrusted-option', onEvent() {}, onReady() {}, spawnProcess() {} };
  for (const run of [app.runner.runHarness, app.delivery.delivery.runHarness, app.delivery.reflection.runHarness, app.director.runHarness]) {
    const forwarded = launcher ? { ...request, launcher } : request;
    assert.deepEqual(await run(request, options), forwarded);
    assert.deepEqual(calls.at(-1), { request: forwarded, options: { ...options, metricsRoot: app.runtime.directory } });
    await run(request);
    assert.deepEqual(calls.at(-1), { request: forwarded, options: { metricsRoot: app.runtime.directory } });
  }
  assert.equal(options.metricsRoot, '/untrusted-option');
});

for (const lane of ['do', 'look', 'discover']) {
  test(`main workload Stop confirms ${lane}, retains partial output and skips only the exact plan key across reopen`, { timeout: 10000 }, async t => {
    const h = fixture(t);
    let app = await h.openApp({ intervalMs: 60000 });
    t.after(() => app.close());
    const id = `work:owned:${lane}`;
    const planKey = `${lane}:actual-plan-key`;
    const ready = Promise.withResolvers();
    const { work } = app.runner.startTracked({ id, kind: 'background', title: 'Owned parent', work: { lane, planKey } }, async signal => {
      ready.resolve();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      return { status: 'interrupted', text: 'Useful partial report.' };
    });
    app.director.active.set('internal-key', { id, title: 'Owned parent', lane, planKey });
    await ready.promise;
    const { createStopWorkloadTool } = await import('../src/cli/hobkin-tools.mjs');
    const tool = createStopWorkloadTool(request => app.stopWorkload(request));
    const execute = request => tool.execute('call', request);
    assert.deepEqual((await execute({ action: 'list' })).details.running, [{ id, title: 'Owned parent', lane }]);
    assert.equal((await app.runtime.state()).runs[id].mainStop, undefined);
    for (const request of [{ action: 'stop', id, reason: ' ' }, { action: 'stop', id, reason: 'x', pid: 1 }, { action: 'stop', id: 'child', reason: 'x' }, { action: 'stop', id, reason: 'x'.repeat(201) }]) {
      await assert.rejects(execute(request));
    }
    writeMode(h.root, { queueSkipped: ['pre-existing'], queueNext: ['unrelated'] });
    const stopping = execute({ action: 'stop', id, reason: '  Safety limit reached.  ' });
    const repeated = execute({ action: 'stop', id, reason: 'Again.' });
    const receipt = (await stopping).details;
    await assert.rejects(repeated);
    await work;
    assert.equal(receipt.stopped, true);
    assert.equal(receipt.id, id);
    assert.equal(receipt.reason, 'Safety limit reached.');
    assert.equal(receipt.partialResult, true);
    assert.equal(readFileSync(receipt.report, 'utf8'), 'Useful partial report.');
    assert.equal(receipt.nestedCleanup, 'unconfirmed');
    await assert.rejects(execute({ action: 'stop', id, reason: 'Again.' }));
    const run = (await app.runtime.state()).runs[id];
    assert.deepEqual(run.mainStop, { source: 'main', reason: 'Safety limit reached.' });
    assert.equal(run.userStop, undefined);
    assert.equal(run.result.text, 'Useful partial report.');
    assert.equal(app.runtime.messages().length, 0);
    await app.close();
    app = await h.openApp({ intervalMs: 60000 });
    const { readMode, pickNext } = await import('../src/cli/work/store.mjs');
    assert.deepEqual(readMode(h.root).queueSkipped, ['pre-existing', planKey]);
    assert.deepEqual(readMode(h.root).queueNext, ['unrelated']);
    const notices = allCardActions(h.root).filter(action => action.mainStop);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].id, `main-stop:${id}`);
    const send = app.runtime.send.bind(app.runtime);
    app.runtime.send = async () => { throw Error('Not admitted.'); };
    await assert.rejects(app.send('Rejected'), /Not admitted/);
    assert.ok(cardActionsToTell(h.root).some(action => action.mainStop));
    app.runtime.send = send;
    await app.send('What happened?');
    await app.runtime.idle();
    const text = app.runtime.messages().find(message => message.role === 'user').content;
    const note = JSON.parse(text.match(/<hobkin-work>\n(.*)\n/)[1]);
    assert.equal(note.mainStopped[0].mainStop.runId, id);
    assert.equal(note.userDid, undefined);
    assert.match(note.mainStopped[0].did, /Do not retry or restart/);
    pickNext(h.root, planKey);
    await app.close();
    app = await h.openApp({ intervalMs: 60000 });
    assert.equal(readMode(h.root).queueSkipped.includes(planKey), false);
    assert.equal(cardActionsToTell(h.root).some(action => action.mainStop), false);
  });
}

test('main workload Stop keeps discovery owned during pending settlement and persists its real planner key before release', { timeout: 10000 }, async t => {
  const h = fixture(t);
  const ready = Promise.withResolvers(), aborted = Promise.withResolvers(), settle = Promise.withResolvers();
  const app = await h.openApp({ intervalMs: 60000, runHarness: async ({ signal }) => {
    ready.resolve();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    aborted.resolve();
    await settle.promise;
    return { status: 'interrupted', text: 'Discovery partial.' };
  } });
  t.after(() => app.close());
  writeMode(h.root, { enabled: true, folder: h.root, startGapMs: 0 });
  const { planWork } = await import('../src/cli/work/plan.mjs');
  const { readMode } = await import('../src/cli/work/store.mjs');
  const plan = () => planWork(h.root, { ...app.director.outlook(), now: Date.now() + 2 * 86400000 });
  const next = plan().next;
  assert.equal(next.key, 'discover');
  app.director.begin(next, plan().budget, readMode(h.root));
  await ready.promise;
  const id = app.director.running()[0].id;
  assert.equal((await app.runtime.state()).runs[id].work.planKey, next.key);
  const stopping = app.stopWorkload({ action: 'stop', id, reason: 'Safety.' });
  await aborted.promise;
  await app.director.tick();
  assert.deepEqual(app.director.running().map(run => run.id), [id]);
  assert.equal(plan().next, null);
  assert.equal(readMode(h.root).queueSkipped.includes(next.key), false);
  let heldBeforeRelease = false;
  const publish = app.director.publish.bind(app.director);
  app.director.publish = () => { if (!app.director.running().length) heldBeforeRelease = readMode(h.root).queueSkipped.includes(next.key); publish(); };
  settle.resolve();
  await stopping;
  await app.director.closing;
  assert.equal(heldBeforeRelease, true);
  assert.equal(plan().entries.find(entry => entry.key === next.key).ownWait, 'skipped');
  assert.equal(plan().next, null);
});

test('main workload Stop rejects unowned targets and completion/failure races without changing queue holds', { timeout: 10000 }, async t => {
  const h = fixture(t);
  const app = await h.openApp({ intervalMs: 60000 });
  t.after(() => app.close());
  const { readMode } = await import('../src/cli/work/store.mjs');
  writeMode(h.root, { queueSkipped: ['pre-existing'], queueNext: ['unrelated'] });
  for (const status of ['completed', 'failed']) {
    const id = `work:race:${status}`;
    const ready = Promise.withResolvers();
    const { work } = app.runner.startTracked({ id, kind: 'background', title: id, work: { lane: 'look', planKey: status } }, async signal => {
      ready.resolve();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      writeMode(h.root, { queueSkipped: [...readMode(h.root).queueSkipped, `during-${status}`] });
      return { status, text: 'Settled another way.' };
    });
    app.director.active.set(id, { id, lane: 'look', planKey: status });
    await ready.promise;
    await assert.rejects(app.stopWorkload({ action: 'stop', id, reason: 'Safety.' }), /not confirmed/);
    await work;
  }
  const ready = Promise.withResolvers(), release = Promise.withResolvers();
  const id = 'work:transport-error';
  const { work } = app.runner.startTracked({ id, kind: 'background', title: id, work: { lane: 'look', planKey: 'transport-error' } }, async () => {
    ready.resolve();
    await release.promise;
    return { status: 'completed' };
  });
  app.director.active.set(id, { id, lane: 'look', planKey: 'transport-error' });
  await ready.promise;
  const kill = app.runner.kill;
  app.runner.kill = async () => { throw Error('Transport failed.'); };
  await assert.rejects(app.stopWorkload({ action: 'stop', id, reason: 'Safety.' }), /Transport failed/);
  app.runner.kill = kill;
  release.resolve();
  await work;
  for (const id of ['message:main', 'routine:unrelated', 'work:another-team', 'helper-name', '1234']) {
    app.director.active.set(id, { id, lane: 'look', planKey: 'fake' });
    await assert.rejects(app.stopWorkload({ action: 'stop', id, reason: 'Safety.' }));
  }
  assert.deepEqual(readMode(h.root).queueSkipped, ['pre-existing', 'during-completed', 'during-failed']);
  assert.deepEqual(readMode(h.root).queueNext, ['unrelated']);
  assert.deepEqual(allCardActions(h.root), []);
});

test('main workload Stop recovers only confirmed missing notices and preserves heard and posted marks', { timeout: 10000 }, async t => {
  const h = fixture(t);
  let app = await h.openApp({ intervalMs: 60000 });
  t.after(() => app.close());
  await app.runtime.change(state => {
    for (const id of ['missing', 'heard', 'abandoned', 'completed', 'mismatch']) {
      state.runs[id] = { id, kind: 'background', title: id, status: 'interrupted', work: { planKey: id, lane: 'discover' }, result: { status: 'interrupted', text: 'Partial.' }, mainStop: { source: 'main', reason: 'Safety.' } };
    }
    delete state.runs.abandoned.result;
    state.runs.completed.status = 'completed';
    state.runs.mismatch.result.status = 'completed';
  });
  markCardActionsHeard(h.root, [{ id: 'main-stop:heard' }]);
  await app.close();
  app = await h.openApp({ intervalMs: 60000 });
  const { readMode } = await import('../src/cli/work/store.mjs');
  assert.deepEqual(readMode(h.root).queueSkipped.sort(), ['heard', 'missing']);
  assert.deepEqual(cardActionsToTell(h.root).map(action => action.id), ['main-stop:missing']);
  assert.deepEqual(allCardActions(h.root).map(action => action.id).sort(), ['main-stop:heard', 'main-stop:missing']);
  await app.refresh();
  const log = readFileSync(join(h.root, 'work/card-actions.jsonl'), 'utf8');
  await app.close();
  app = await h.openApp({ intervalMs: 60000 });
  assert.equal(readFileSync(join(h.root, 'work/card-actions.jsonl'), 'utf8'), log);
});

test('presentation clear state is private, unions across writes and hides messages after reopen', t => {
  const h = fixture(t);
  atomicJson(join(h.root, 'runtime/view.json'), {
    version: 1,
    messages: [
      { id: 'old', role: 'assistant', content: 'Old answer' },
      { id: 'new', role: 'assistant', content: 'New answer' },
    ],
  });
  assert.deepEqual(savePresentationState(h.root, ['old']).hiddenMessageIds, ['old']);
  assert.deepEqual(savePresentationState(h.root, ['new']).hiddenMessageIds, ['old', 'new']);
  assert.deepEqual(readPresentationState(h.root).hiddenMessageIds, ['old', 'new']);
  const file = join(h.root, 'runtime/presentation.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const saved = readFileSync(file, 'utf8');
  const tooMany = Array.from({ length: 10000 }, (_, index) => `message-${index}-${'x'.repeat(100)}`);
  assert.throws(() => savePresentationState(h.root, tooMany), /byte limit/i);
  assert.equal(readFileSync(file, 'utf8'), saved);
  const reopened = readLocalView(h.root);
  assert.deepEqual(reopened.presentation.hiddenMessageIds, ['old', 'new']);
  const ui = createDashboard(reopened);
  assert.doesNotMatch(stripTerminalSequences(ui.render(80, 24).join('\\n')), /Old answer|New answer/);
});

test('saved reports retain real results from an older view format', t => {
  const h = fixture(t);
  const report = { id: 'check:one', title: 'Local check', body: 'A real finding' };
  atomicJson(join(h.root, 'runtime/view.json'), {
    version: 1,
    reports: [{ id: 'patterns-offer', body: 'Old setup guide' }, report],
  });

  const local = readLocalView(h.root);
  assert.deepEqual(local.reports, [report]);
});

test('local imported reports survive saved views, live refresh and restart without entering context or spend', async t => {
  const h = fixture(t);
  const historical = {
    id: 'local:original:report',
    title: 'Historical report',
    body: 'Preserved history',
    at: '2025-12-01T00:00:00Z',
    outcome: 'imported',
    origin: 'legacy-state',
    path: '/original/report.json',
    readState: 'read',
    readAt: '2025-12-02T00:00:00Z',
  };
  const file = join(h.root, 'runtime/imported-reports.json');
  atomicJson(file, { version: 1, reports: [historical] });
  atomicJson(join(h.root, 'runtime/view.json'), { version: 1, reports: [] });
  assert.deepEqual(readLocalView(h.root).reports, [{ ...historical, truncated: false }]);
  const bytes = readFileSync(file, 'utf8');
  for (let attempt = 0; attempt < 2; attempt++) {
    const app = await h.openApp();
    try {
      const view = await app.refresh();
      assert.equal(view.reports.length, 1);
      assert.equal(view.reports[0].readAt, historical.readAt);
      assert.equal(view.usage.usd, 0);
      assert.equal(app.runtime.messages().length, 0);
      assert.deepEqual((await app.runtime.state()).runs, {});
    } finally {
      await app.close();
    }
    assert.equal(readLocalView(h.root).reports.length, 1);
  }
  assert.equal(readFileSync(file, 'utf8'), bytes);
  atomicJson(file, { version: 1, reports: [{ ...historical, body: null }] });
  assert.throws(() => readLocalView(h.root), /imported report/i);
});

test('connected application serves input while a background check waits, saves reports/cost, and restores one main', { timeout: 10000 }, async t => {
  const h = fixture(t);
  const gate = Promise.withResolvers();
  const started = Promise.withResolvers();
  const schedule = {
    id: 'check',
    title: 'Check',
    at: '09:00',
    timezone: 'UTC',
    cwd: h.root,
    context: [],
    enabled: true,
    harness: 'pi',
    model: 'fixture/check',
    effort: 'medium',
  };
  for (const id of ['check', 'check-two']) {
    writeFileSync(join(h.root, `routines/daily/${id}.md`), `---\n${JSON.stringify({ ...schedule, id })}\n---\nCheck local state.\n`);
  }
  let now = new Date('2026-01-02T10:00:00Z');
  let calls = 0;
  const answer = '# Findings\n\nA useful detail\n';
  const failure = 'Pi session identity changed during the job.';
  const failureBody = `${answer}\n\n---\n\n**Execution failure:** ${failure}`;
  const runHarness = async request => {
    const call = ++calls;
    if (call === 2) started.resolve();
    await gate.promise;
    return {
      status: call === 1 ? 'failed' : 'completed',
      sessionId: request.id,
      freshSession: true,
      cost: { usd: 0.1, sessionId: request.id, kind: 'estimate', cumulative: true },
      text: answer,
      ...(call === 1 ? { error: failure } : {}),
    };
  };
  const app = await h.openApp({
    runHarness,
    sessionDependencies: h.fake.dependencies,
    now: () => now,
    intervalMs: 60000,
  });
  t.after(async () => {
    gate.resolve();
    await app.close();
  });

  await app.runner.tick();
  assert.deepEqual((await app.runner.snapshot()).errors, []);
  await started.promise;
  const control = h.fake.controls.get(app.runtime.main.sessionId);
  control.gate = Promise.withResolvers();
  await app.send('Hello');
  const concurrent = await app.refresh();
  assert.equal(concurrent.runs.filter(run => run.state === 'running').length, 3);
  assert.deepEqual(concurrent.runs.filter(run => run.state === 'running').map(run => run.kind).sort(), ['background', 'background', 'main']);
  control.gate.resolve();
  await app.runtime.mainWork;
  assert.equal(app.runtime.mainBusy, false);
  assert.equal(app.runtime.active.size, 2);
  const ui = createDashboard(await app.refresh(), { send: text => app.send(text) });
  const sessionBytes = readFileSync(app.runtime.main.sessionFile, 'utf8');
  const stateBeforeClear = await app.runtime.state();
  ui.input('/clear');
  ui.input('\r');
  await ui.pending();
  ui.update(await app.refresh());
  assert.doesNotMatch(stripTerminalSequences(ui.render(80, 24).join('\n')), /Reply: Hello/);
  assert.equal(readFileSync(app.runtime.main.sessionFile, 'utf8'), sessionBytes);
  assert.deepEqual(await app.runtime.state(), stateBeforeClear);
  assert.equal(app.runtime.active.size, 2);

  gate.resolve();
  await app.runtime.idle();
  await app.refresh();
  const snapshot = app.snapshot;
  assert.equal(snapshot.connection, 'connected');
  assert.equal(snapshot.counts.daily, 2);
  assert.equal(snapshot.runs.filter(run => run.state === 'running').length, 0);
  assert.equal(snapshot.schedules[0].nextRun.at, '2026-01-03T09:00:00.000Z');
  assert.ok(snapshot.messages.some(message => message.content === 'Reply: Hello'));
  const backgroundRuns = Object.values((await app.runtime.state()).runs).filter(run => run.kind === 'background');
  const failedRun = backgroundRuns.find(run => run.status === 'failed');
  const completedRun = backgroundRuns.find(run => run.status === 'completed');
  assert.ok(failedRun && completedRun);
  const files = readdirSync(join(h.root, 'reports')).map(name => join(h.root, 'reports', name));
  assert.equal(files.length, 2);
  assert.deepEqual(files.map(file => readFileSync(file, 'utf8')).sort(), [answer, failureBody].sort());
  const failedReport = snapshot.reports.find(report => report.id === failedRun.id);
  assert.equal(failedReport.body, failureBody);
  assert.equal(snapshot.reports.find(report => report.id === completedRun.id).body, answer);
  const failureUi = createDashboard({ ...snapshot, reports: [failedReport] });
  failureUi.input('\x1b[C');
  failureUi.input('\x1b[B');
  failureUi.input('\r');
  const displayedFailure = stripTerminalSequences(failureUi.render(120, 40).join('\n'));
  assert.match(displayedFailure, /A useful detail/);
  assert.match(displayedFailure, /Pi session identity changed during the job\./);
  const viewFile = join(h.root, 'runtime/view.json');
  const savedView = readFileSync(viewFile, 'utf8');
  const displayedTick = app.snapshot.lastTick;
  const persistedTick = (await app.runtime.state()).lastTick;
  now = new Date(now.getTime() + 1000);
  await app.runner.tick();
  await app.refresh();
  assert.notEqual(app.snapshot.lastTick, displayedTick);
  assert.equal(app.snapshot.lastTick, now.toISOString());
  assert.equal((await app.runtime.state()).lastTick, persistedTick);
  assert.equal(readFileSync(viewFile, 'utf8'), savedView);
  const fromFile = '# Reviewed file\n\nFile is authoritative.\n';
  const completedFile = files.find(file => readFileSync(file, 'utf8') === answer);
  writeFileSync(completedFile, fromFile);
  await app.runtime.finish(completedRun.id, completedRun.result);
  await assert.rejects(app.runtime.finish(completedRun.id, { status: 'failed', text: 'Replacement' }), /conflicting/);
  assert.equal(readFileSync(completedFile, 'utf8'), fromFile);
  assert.ok(Math.abs(snapshot.usage.usd - 0.45) < 1e-9);
  assert.equal(statSync(join(h.root, 'runtime/view.json')).mode & 0o777, 0o600);
  await assert.rejects(h.openApp(), /already running/);
  const sessionId = app.runtime.main.sessionId;
  await app.close();
  const local = readLocalView(h.root);
  assert.equal(local.connection, 'offline');
  assert.equal(local.reports.find(report => report.id === failedRun.id).body, failureBody);
  assert.equal(local.reports.find(report => report.id === completedRun.id).body, fromFile);
  assert.ok(Math.abs(local.usage.usd - 0.45) < 1e-9);
  assert.ok(local.messages.some(message => message.content === 'Reply: Hello'));
  const restored = await h.openApp({ runHarness, now: () => new Date('2026-01-02T10:00:00Z') });
  try {
    await restored.runner.tick();
    await restored.runtime.idle();
    assert.equal(restored.runtime.main.sessionId, sessionId);
    const restoredReports = (await restored.refresh()).reports;
    assert.equal(restoredReports.find(report => report.id === failedRun.id).body, failureBody);
    assert.equal(restoredReports.find(report => report.id === completedRun.id).body, fromFile);
    assert.equal(calls, 2);
  } finally {
    await restored.close();
  }
});

test('activity projection keeps live scheduled jobs visible beyond history limits', async t => {
  const h = fixture(t);
  for (const [id, title, at] of [['daily-one', 'Daily audit', '09:00'], ['daily-two', 'Backup review', '10:00']]) {
    const schedule = {
      id,
      title,
      at,
      timezone: 'UTC',
      cwd: h.root,
      context: [],
      enabled: true,
      harness: 'pi',
      model: 'fixture/check',
      effort: 'medium',
    };
    writeFileSync(join(h.root, `routines/daily/${id}.md`), `---\n${JSON.stringify(schedule)}\n---\nCheck local state.\n`);
  }
  const app = await h.openApp();
  const state = app.runtime.state.bind(app.runtime);
  const runs = {
    main: { id: 'main', kind: 'main', status: 'running', startedAt: '2026-01-02T09:00:00Z' },
    'daily-job': {
      id: 'daily-job', kind: 'background', scheduleId: 'daily-one', title: 'Daily audit', status: 'running',
      harness: 'fixture-harness', model: 'fixture/daily', effort: 'high', cwd: '/tmp/live-daily',
      startedAt: '2026-01-02T10:00:00Z',
    },
    'backup-job': {
      id: 'backup-job', kind: 'background', scheduleId: 'daily-two', title: 'Backup review', status: 'running',
      harness: 'fixture-harness', model: 'fixture/backup', effort: 'low', cwd: '/tmp/live-backup',
      startedAt: '2026-01-02T10:01:00Z',
    },
  };
  for (let index = 0; index < 105; index++) {
    const id = `history-${String(index).padStart(3, '0')}`;
    runs[id] = {
      id,
      kind: 'background',
      status: 'completed',
      startedAt: new Date(Date.parse('2026-01-03T00:00:00Z') + index * 1000).toISOString(),
    };
  }
  app.runtime.state = async () => ({ ...await state(), runs });
  try {
    const view = await app.refresh();
    assert.equal(view.counts.daily, 2);
    assert.equal(view.runs.length, 103);
    assert.ok(view.runs.some(run => run.id === 'history-104'));
    assert.ok(!view.runs.some(run => run.id === 'history-004'));
    assert.deepEqual(
      view.runs.filter(run => run.state === 'running').map(run => run.id).sort(),
      ['backup-job', 'daily-job', 'main'],
    );
    assert.equal(view.runs.find(run => run.id === 'daily-job').scheduleId, 'daily-one');
    assert.equal(view.runs.find(run => run.id === 'backup-job').scheduleId, 'daily-two');
    const ui = createDashboard(view);
    ui.input('\x1b[C');
    ui.input('\x1b[C');
    const live = stripTerminalSequences(ui.render(140, 60).join('\n'));
    assert.match(live, /Routines 2\b/);
    assert.match(live, /2 running/);
    for (const text of [
      'Daily audit', 'Backup review', 'fixture-harness', 'fixture/daily', 'fixture/backup',
      'high', 'low',
    ]) {
      assert.ok(live.includes(text), `Missing live schedule detail: ${text}`);
    }
    const offline = readLocalView(h.root);
    assert.equal(offline.connection, 'offline');
    assert.equal(offline.runs.filter(run => run.state === 'running').length, 3);
    const staleUi = createDashboard(offline);
    staleUi.input('\x1b[C');
    staleUi.input('\x1b[C');
    const stale = stripTerminalSequences(staleUi.render(140, 60).join('\n'));
    assert.doesNotMatch(stale, /Running now|2 running/);
  } finally {
    app.runtime.state = state;
    await app.close();
  }
});

test('closing drains interrupted background and main work and releases ownership without retrying', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  const control = h.fake.controls.get(app.runtime.main.sessionId);
  control.gate = Promise.withResolvers();
  await app.send('Wait here');
  await app.close();
  await app.close();
  assert.equal(control.aborted, true);
  const local = readLocalView(h.root);
  assert.ok(local.runs.some(run => run.state === 'interrupted'));
  assert.ok(local.usage.issues.missing_final_receipt > 0);
  const next = await h.openApp();
  await next.close();
  assert.equal(control.calls, 1);
});

const backgroundRun = (id, overrides = {}) => ({
  id,
  kind: 'background',
  scheduleId: id,
  title: id,
  status: 'completed',
  startedAt: '2026-01-02T08:00:00.000Z',
  finishedAt: '2026-01-02T08:01:00.000Z',
  result: { status: 'completed', text: 'Synthetic report.' },
  ...overrides,
});

test('visible scheduled reports add stable local notices without changing context', async t => {
  const h = fixture(t);
  let providerCalls = 0;
  const runHarness = async () => {
    providerCalls++;
    throw Error('Unexpected provider call in synthetic notice test.');
  };
  const importedReport = {
    id: 'imported:prior',
    title: 'Imported report',
    body: 'Imported body',
    at: '2025-12-01T00:00:00Z',
    outcome: 'imported',
    origin: 'legacy-state',
    path: '/prior/report.json',
    readState: 'unread',
    readAt: null,
  };
  atomicJson(join(h.root, 'runtime/imported-reports.json'), { version: 1, reports: [importedReport] });
  const seed = await HobkinRuntime.open(h.root, h.config);
  await seed.change(state => { state.runs['old-schedule'] = backgroundRun('old-schedule'); });
  await seed.close();

  const app = await h.openApp({ runHarness });
  let notice;
  let notices;
  try {
    assert.equal((await app.refresh()).messages.filter(message => message.role === 'notice').length, 0);
    const contextMessagesBefore = app.runtime.messages();
    await app.runtime.change(state => {
      state.runs['new-schedule'] = backgroundRun('new-schedule', {
        title: 'Morning check', finishedAt: '2026-01-02T09:01:00.000Z',
      });
      state.runs['calendar-no-change'] = backgroundRun('calendar-no-change', { status: 'no_change' });
      state.runs['manual-no-change'] = backgroundRun('manual-no-change', { status: 'no_change', trigger: 'manual' });
      state.runs['scheduled-failure'] = backgroundRun('scheduled-failure', { status: 'failed' });
      state.runs['scheduled-incomplete'] = backgroundRun('scheduled-incomplete', { status: 'incomplete' });
      const maintenance = backgroundRun('background-maintenance', { status: 'failed' });
      delete maintenance.scheduleId;
      state.runs['background-maintenance'] = maintenance;
    });
    const view = await app.refresh();
    notices = view.messages.filter(message => message.role === 'notice');
    notice = notices.find(message => /Morning check/i.test(message.content));
    assert.deepEqual(notices.map(message => message.content).sort(), [
      'Report available for Morning check', 'Report available for manual-no-change',
      'Report available for scheduled-failure', 'Report available for scheduled-incomplete',
    ].sort());
    assert.equal(notice.at, '2026-01-02T09:01:00.000Z');
    assert.deepEqual(app.runtime.messages(), contextMessagesBefore);
    assert.equal(view.reports.find(report => report.id === 'new-schedule').at, notice.at);
    assert.equal(view.reports.some(report => report.id === 'calendar-no-change'), false);
    assert.equal(view.reports.find(report => report.id === 'manual-no-change').outcome, 'no_change');
    assert.equal(view.reports.find(report => report.id === 'scheduled-failure').outcome, 'failed');
    assert.equal(view.reports.find(report => report.id === 'scheduled-incomplete').outcome, 'incomplete');
    assert.ok(view.reports.some(report => report.id === 'background-maintenance'));
    assert.equal(view.reports.find(report => report.id === 'imported:prior').at, '2025-12-01T00:00:00Z');
    assert.deepEqual((await app.refresh()).messages.filter(message => message.role === 'notice').map(message => message.id).sort(),
      notices.map(message => message.id).sort());
    assert.equal(view.usage.usd, 0);
    assert.equal(statSync(join(h.root, 'runtime/view.json')).mode & 0o777, 0o600);
    assert.equal(providerCalls, 0);
  } finally {
    await app.close();
  }

  const reopened = await h.openApp({ runHarness });
  try {
    const view = await reopened.refresh();
    assert.deepEqual(view.messages.filter(message => message.role === 'notice').map(message => message.id).sort(),
      notices.map(message => message.id).sort());
    const ui = createDashboard(view, { clear: ids => savePresentationState(h.root, ids) });
    ui.input('/clear');
    ui.input('\r');
    await ui.pending();
    ui.update(await reopened.refresh());
    assert.doesNotMatch(stripTerminalSequences(ui.render(80, 24).join('\n')), /Report available for Morning check/);
  } finally {
    await reopened.close();
  }

  const hidden = readLocalView(h.root);
  assert.ok(notices.every(message => hidden.presentation.hiddenMessageIds.includes(message.id)));
  const final = await h.openApp({ runHarness });
  try {
    const view = await final.refresh();
    assert.deepEqual(view.messages.filter(message => message.role === 'notice').map(message => message.id).sort(),
      notices.map(message => message.id).sort());
    assert.doesNotMatch(stripTerminalSequences(createDashboard(view).render(80, 24).join('\n')), /Report available for/);
    assert.equal(providerCalls, 0);
  } finally {
    await final.close();
  }
});

test('scheduled reports talk back in chat only for critical or useful triage lines', async t => {
  const h = fixture(t);
  const runHarness = async () => { throw Error('Unexpected provider call in synthetic triage test.'); };
  const app = await h.openApp({ runHarness });
  try {
    const contextMessagesBefore = app.runtime.messages();
    await app.runtime.change(state => {
      state.runs.critical = backgroundRun('critical', {
        title: 'Financial freedom',
        result: { status: 'completed', text: '**Critical:** Rent is due tomorrow and the balance is short.\n\nDetails.' },
      });
      state.runs.useful = backgroundRun('useful', {
        title: 'Health progress',
        result: { status: 'completed', text: 'Useful: Resting heart rate fell 3 bpm over two weeks.\n\nDetails.' },
      });
      state.runs.quiet = backgroundRun('quiet', {
        title: 'Calendar deadlines',
        result: { status: 'completed', text: 'Nothing new.\n\nChecked the next 14 days.' },
      });
    });

    const view = await app.refresh();

    const notices = view.messages.filter(message => message.role === 'notice')
      .map(({ content, tone }) => ({ content, tone }))
      .sort((left, right) => left.content.localeCompare(right.content));
    assert.deepEqual(notices, [
      { content: 'Financial freedom: Rent is due tomorrow and the balance is short.', tone: 'critical' },
      { content: 'Health progress: Resting heart rate fell 3 bpm over two weeks.', tone: 'useful' },
    ]);
    assert.deepEqual(app.runtime.messages(), contextMessagesBefore);
  } finally {
    await app.close();
  }
});

test('a report that needs the user shows its one call with the notice', async t => {
  const h = fixture(t);
  const runHarness = async () => { throw Error('Unexpected provider call in synthetic triage test.'); };
  const app = await h.openApp({ runHarness });
  try {
    await app.runtime.change(state => {
      state.runs.useful = backgroundRun('useful', {
        title: 'Mail',
        result: { status: 'completed', text: 'Useful: The bank wrote back.\n\nNext: Reply by Friday.\n\nDetails.' },
      });
    });

    const view = await app.refresh();

    const [notice] = view.messages.filter(message => message.role === 'notice');
    assert.equal(notice.content, 'Mail: The bank wrote back. Next: Reply by Friday.');
  } finally {
    await app.close();
  }
});

test('a scheduled check that found nothing new stays out of Reports, and a run the user asked for stays in', async t => {
  const h = fixture(t);
  const runHarness = async () => { throw Error('Unexpected provider call in synthetic report test.'); };
  const app = await h.openApp({ runHarness });
  try {
    const quiet = { status: 'completed', text: 'Nothing new.\n\nChecked the next 14 days.' };
    await app.runtime.change(state => {
      state.runs.quiet = backgroundRun('quiet', { result: quiet });
      state.runs.asked = backgroundRun('asked', { trigger: 'manual', result: quiet });
    });

    const view = await app.refresh();

    assert.deepEqual(view.reports.map(report => report.id).filter(id => ['quiet', 'asked'].includes(id)), ['asked']);
  } finally {
    await app.close();
  }
});

test('a blocked check talks back in chat and says when a repeat pauses it', async t => {
  const h = fixture(t);
  mkdirSync(join(h.root, 'routines/daily'), { recursive: true });
  writeFileSync(join(h.root, 'routines/daily/mail.md'), `---\n${JSON.stringify({
    id: 'mail', title: 'Mail', at: '23:00', timezone: 'UTC', enabled: true,
    harness: 'pi', model: 'fixture/check', effort: 'medium', cwd: h.root, context: [],
  })}\n---\nCheck mail.\n`);
  const runHarness = async () => { throw Error('Unexpected provider call in synthetic hold test.'); };
  const app = await h.openApp({ runHarness, now: () => new Date('2026-01-02T12:00:00Z') });
  const blocked = (id, finishedAt) => backgroundRun(id, {
    title: 'Mail', scheduleId: 'mail', finishedAt,
    result: { status: 'completed', text: 'Blocked: Gmail tools are unavailable.\n\nDetails.' },
  });
  const notices = view => view.messages.filter(message => message.role === 'notice').map(({ content, tone }) => ({ content, tone }));
  try {
    await app.runtime.change(state => { state.runs.first = blocked('first', '2026-01-02T09:00:00.000Z'); });
    await app.runner.tick();
    assert.deepEqual(notices(await app.refresh()), [
      { content: 'Mail: Gmail tools are unavailable.', tone: 'blocked' },
    ]);

    await app.runtime.change(state => { state.runs.second = blocked('second', '2026-01-02T10:00:00.000Z'); });
    await app.runner.tick();
    assert.deepEqual(notices(await app.refresh()).at(-1), {
      content: 'Mail: Gmail tools are unavailable. Paused until Jan 3; running it manually or editing the routine resumes it sooner.',
      tone: 'blocked',
    });
  } finally {
    await app.close();
  }
});

test('application kill delegates the run ID and preserves false/error outcomes', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  t.after(async () => app.close());
  const requested = [];
  app.runner.kill = async runId => {
    requested.push(runId);
    if (runId === 'error') throw Error('Cancellation unavailable.');
    return runId === 'live-owned';
  };

  assert.equal(await app.kill('live-owned'), true);
  assert.equal(await app.kill('stale'), false);
  await assert.rejects(app.kill('error'), /Cancellation unavailable/);
  assert.deepEqual(requested, ['live-owned', 'stale', 'error']);
});

test('application reset refreshes the connected view after preserving the previous session', async t => {
  const h = fixture(t);
  const toolSets = [];
  const createSession = h.fake.dependencies.createSession;
  h.fake.dependencies.createSession = async options => {
    toolSets.push(options.customTools);
    return createSession(options);
  };
  const app = await h.openApp();
  t.after(async () => app.close());
  await app.send('Preserve this transcript');
  await app.runtime.idle();

  const previous = app.runtime.main;
  const previousBytes = readFileSync(previous.sessionFile);
  const binding = app.snapshot.main;
  const dashboard = createDashboard(app.snapshot);
  app.onChange = view => dashboard.update(view);
  const reset = await app.reset();
  const tools = toolSets.at(-1);
  assert.deepEqual(tools.map(tool => tool.name), ['ask_question', 'run_routine', 'message_check', 'hobkin_memory', 'model_settings']);
  const activeBinding = (await tools.find(tool => tool.name === 'model_settings').execute('binding', {
    action: 'inspect', scope: 'main',
  })).details.activeMainBinding;
  assert.deepEqual(activeBinding, { model: binding.model, effort: binding.effort });

  assert.notEqual(reset.sessionId, previous.sessionId);
  assert.equal((await app.runtime.state()).main.sessionId, reset.sessionId);
  assert.equal(app.runtime.messages().length, 0);
  assert.equal(app.snapshot.connection, 'connected');
  assert.equal(app.snapshot.messages.length, 0);
  assert.equal(app.snapshot.main.model, binding.model);
  assert.equal(app.snapshot.main.effort, binding.effort);
  assert.equal(app.snapshot.usage.usd, 0);
  assert.match(stripTerminalSequences(dashboard.render(80, 24).join('\n')), /\$0\.00 est\./);
  assert.equal(readLocalView(h.root).usage.usd, 0);
  assert.deepEqual(readFileSync(previous.sessionFile), previousBytes);
  const header = JSON.parse(readFileSync(reset.sessionFile, 'utf8').split('\\n')[0]);
  assert.equal(header.id, reset.sessionId);
  assert.equal(statSync(reset.sessionFile).mode & 0o777, 0o600);

  await app.send('Accrue from reset');
  await app.runtime.idle();
  assert.equal((await app.refresh()).usage.usd, 0.25);
  assert.match(stripTerminalSequences(dashboard.render(80, 24).join('\n')), /\$0\.25 est\./);
  assert.equal(readLocalView(h.root).usage.usd, 0.25);
});

test('failed application reset leaves the displayed estimate unchanged', async t => {
  const h = fixture(t);
  const createMain = h.fake.createMain;
  let failFresh = false;
  h.fake.createMain = options => options.fresh && failFresh
    ? Promise.reject(Error('Unable to start fresh session.'))
    : createMain(options);
  const app = await h.openApp();
  t.after(() => app.close());
  await app.send('Keep this estimate');
  await app.runtime.idle();
  assert.equal((await app.refresh()).usage.usd, 0.25);

  failFresh = true;
  await assert.rejects(app.reset(), /Unable to start fresh session/);
  assert.equal(app.snapshot.usage.usd, 0.25);
  assert.equal(readLocalView(h.root).usage.usd, 0.25);
});

test('message projection orders timestamps and bounds notices without dropping recent conversation', async t => {
  const h = fixture(t);
  atomicJson(join(h.root, 'runtime/view.json'), { version: 1, messages: [
    { id: 'notice:untimed-a', role: 'notice', content: 'Earlier untimed notice A' },
    { id: 'notice:untimed-b', role: 'notice', content: 'Earlier untimed notice B' },
    { id: 'notice:dated', role: 'notice', content: 'Earlier dated notice', at: '2026-01-02T07:00:00.000Z' },
  ] });
  let app = await h.openApp();
  let messageIds;
  try {
    const initial = await app.refresh();
    assert.deepEqual(initial.messages.map(message => message.id), [
      'notice:untimed-a', 'notice:untimed-b', 'notice:dated',
    ]);
    await app.send('Latest user message');
    const transcript = app.runtime.messages();
    const user = transcript.findLast(message => message.role === 'user');
    const assistant = transcript.findLast(message => message.role === 'assistant');
    await app.runtime.change(state => {
      for (let index = 0; index < 105; index++) {
        const id = `scheduled-${String(index).padStart(3, '0')}`;
        state.runs[id] = backgroundRun(id, {
          title: `Scheduled ${index}`,
          finishedAt: new Date(user.timestamp - 60000 + index).toISOString(),
        });
      }
    });
    const view = await app.refresh();
    messageIds = view.messages.map(message => message.id);
    const notices = view.messages.filter(message => message.role === 'notice');
    assert.equal(view.messages.length, 100);
    assert.equal(notices.length, 98);
    assert.equal(new Set(messageIds).size, messageIds.length);
    assert.deepEqual(view.messages.slice(-2).map(({ role, content, at }) => [role, content, at]), [
      ['user', 'Latest user message', user.timestamp],
      ['assistant', 'Reply: Latest user message', assistant.timestamp],
    ]);
    assert.deepEqual((await app.refresh()).messages.map(message => message.id), messageIds);
  } finally {
    await app.close();
  }

  app = await h.openApp();
  try {
    assert.deepEqual((await app.refresh()).messages.map(message => message.id), messageIds);
  } finally {
    await app.close();
  }
});

test('job activity is transient and quiet completion hands off exact saved Markdown', async t => {
  const h = fixture(t);
  const app = await h.openApp({ intervalMs: 60000 });
  t.after(() => app.close());
  await app.runtime.admit({ id: 'live', kind: 'background', scheduleId: 'check', title: 'Check' });
  await app.refresh();
  const files = ['runtime/view.json'];
  const before = files.map(file => readFileSync(join(h.root, file), 'utf8'));
  app.observeActivity('live', { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Preview' } });
  const view = await app.refresh();
  assert.equal(view.jobActivity.live[0].text, 'Preview');
  assert.deepEqual(files.map(file => readFileSync(join(h.root, file), 'utf8')), before);
  const durableBefore = await app.runtime.state();
  app.observeActivity('live', { type: 'response', data: 'SECRET' });
  await app.refresh();
  assert.deepEqual(await app.runtime.state(), durableBefore);
  app.onChange = null;
  await app.runtime.change(state => {
    for (let index = 0; index < 105; index++) state.runs[`newer-${index}`] = backgroundRun(`newer-${index}`, { startedAt: '2099-01-01T00:00:00Z' });
  });
  const body = '# Exact\n\nQuiet report.\n';
  await app.runtime.finish('live', { status: 'no_change', text: body });
  saveReport(h.root, 'live', body);
  await app.refresh();
  let notified;
  app.onChange = view => { notified = view; };
  const completed = await app.refresh();
  assert.equal(notified.completedJobReports.live.body, body);
  assert.equal(completed.completedJobReports.live.body, body);
  assert.equal(completed.completedJobReports.live.outcome, 'no_change');
  assert.equal(completed.completedJobReports.live.scheduleId, 'check');
  assert.equal(completed.reports.some(report => report.id === 'live'), false);
  assert.deepEqual(completed.jobActivity, {});
  assert.equal(app.jobActivity.size, 0);
  await app.runtime.admit({ id: 'unsaved', kind: 'background', scheduleId: 'check' });
  await app.refresh();
  await app.runtime.change(state => { state.runs.unsaved.status = 'failed'; });
  assert.equal((await app.refresh()).completedJobReports.unsaved, undefined);
});

test('completion outcomes replay delayed saved reports across refresh and reconnect within a bounded window', { timeout: 10000 }, async t => {
  const h = fixture(t);
  const options = { intervalMs: 60000, runHarness: async () => { throw Error('Unexpected launcher'); } };
  const app = await h.openApp(options);
  t.after(() => app.close());
  await app.runtime.change(state => {
    state.runs.delayed = backgroundRun('delayed');
    state.runs.old = backgroundRun('old', { startedAt: '2020-01-01T00:00:00Z' });
    for (let index = 0; index < 99; index++) state.runs[`recent-${index}`] = backgroundRun(`recent-${index}`);
  });
  saveReport(h.root, 'old', 'Outside the bounded window.');
  assert.equal((await app.refresh()).completedJobReports.delayed, undefined);
  saveReport(h.root, 'delayed', '# Actual delayed report\n');
  for (let attempt = 0; attempt < 2; attempt++) {
    const outcomes = (await app.refresh()).completedJobReports;
    assert.equal(outcomes.delayed.body, '# Actual delayed report\n');
    assert.equal(outcomes.old, undefined);
  }
  await app.close();
  const reopened = await h.openApp(options);
  try {
    assert.equal((await reopened.refresh()).completedJobReports.delayed.body, '# Actual delayed report\n');
  } finally {
    await reopened.close();
  }
});

test('completion outcomes prove absence only for quiet or deleted reports', { timeout: 10000 }, async t => {
  const h = fixture(t);
  const app = await h.openApp({ intervalMs: 60000, runHarness: async () => { throw Error('Unexpected launcher'); } });
  t.after(() => app.close());
  await app.runtime.change(state => {
    state.runs.quiet = backgroundRun('quiet', { result: { status: 'completed', text: 'Nothing new.' } });
    state.runs.manual = backgroundRun('manual', { trigger: 'manual', result: { status: 'completed', text: 'Nothing new.' } });
    state.runs.deleted = backgroundRun('deleted');
    state.runs.unknown = backgroundRun('unknown', { status: 'failed' });
    state.runs.running = backgroundRun('running', { status: 'running' });
  });
  saveReport(h.root, 'deleted', 'Previously available.');
  deleteReports(h.root, ['deleted']);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual((await app.refresh()).completedJobReports, { quiet: null, deleted: null });
  }
});

test('scheduled ticks and sessions reserve two ordinary places independently of the Work pool', async t => {
  const h = fixture(t);
  h.config.concurrency = 2;
  atomicJson(join(h.root, 'config.json'), h.config);
  const gate = Promise.withResolvers();
  const ready = Promise.withResolvers();
  let calls = 0;
  const app = await h.openApp({ intervalMs: 60000, now: () => new Date('2026-01-02T10:00:00Z'),
    runHarness: async () => { if (++calls === 2) ready.resolve(); return gate.promise; } });
  t.after(() => { gate.resolve({ status: 'completed', text: 'Done.' }); return app.close(); });
  await app.runner.tick();
  writeMode(h.root, { enabled: true, agents: 1 });
  const work = app.runner.startTracked({ id: 'work:fixture', kind: 'background', work: { lane: 'do' } }, () => gate.promise).work;
  const schedule = { id: 'check', title: 'Check', at: '09:00', timezone: 'UTC', cwd: h.root,
    context: [], enabled: true, harness: 'pi', model: 'fixture/check', effort: 'medium' };
  writeFileSync(join(h.root, 'routines/daily/check.md'), `---\n${JSON.stringify(schedule)}\n---\nCheck local state.\n`);
  const sessions = [];
  for (const title of ['Alpha', 'Beta']) sessions.push(await startSession({ root: h.root, title, brief: 'Inspect.', cwd: h.root }));
  const tick = app.runner.tick();
  const ended = app.tickSessions();
  await Promise.all([tick, ready.promise]);
  await app.runner.serialize(() => {});
  assert.equal(calls, 2, 'one scheduled check and one session start');
  assert.equal(app.runner.jobs.size, 3, 'Work retains its separate place');
  assert.equal(app.runner.scheduledJobCount(await app.runtime.state()), 2, 'Work agents does not cap ordinary sessions');
  assert.deepEqual(readdirSync(join(h.root, 'runtime/session-requests')), [`${sessions[1].name}.json`]);
  gate.resolve({ status: 'completed', text: 'Done.' });
  await Promise.all([ended, work, ...app.runner.jobs.values()]);
  await app.tickSessions();
  assert.equal(calls, 3);
  assert.deepEqual(readdirSync(join(h.root, 'runtime/session-requests')), []);
});

test('looking for sessions to start counts the running checks from the run index, never reading every run whole', async t => {
  const h = fixture(t);
  const app = await h.openApp({ intervalMs: 60000, runHarness: async () => ({ status: 'completed', text: 'Done.' }) });
  t.after(() => app.close());
  const whole = app.runtime.state.bind(app.runtime);
  let wholeReads = 0;
  app.runtime.state = () => { wholeReads++; return whole(); };
  assert.deepEqual(await app.tickSessions(), []);
  assert.equal(wholeReads, 0);
});

for (const enabled of [false, true]) {
  test(`queued sessions share ordinary check admission with Work ${enabled ? 'enabled' : 'disabled'}`, async t => {
    const h = fixture(t);
    h.config.concurrency = 1;
    atomicJson(join(h.root, 'config.json'), h.config);
    const calls = [];
    const started = [0, 1, 2, 3].map(() => Promise.withResolvers());
    const gates = started.map(() => Promise.withResolvers());
    const app = await h.openApp({ intervalMs: 60000, now: () => new Date('2026-01-02T08:00:00Z'),
      runHarness: async request => {
        const index = calls.push(request) - 1;
        request.signal.addEventListener('abort', () => gates[index].resolve({ status: 'interrupted', text: 'Partial.' }), { once: true });
        started[index].resolve();
        return gates[index].promise;
      } });
    t.after(() => { gates.forEach(gate => gate.resolve({ status: 'interrupted', text: '' })); return app.close(); });
    await app.runner.tick();
    writeMode(h.root, { enabled });
    const schedule = { id: 'check', title: 'Check', at: '09:00', timezone: 'UTC', cwd: h.root,
      context: [], enabled: true, harness: 'pi', model: 'fixture/check', effort: 'medium' };
    writeFileSync(join(h.root, 'routines/daily/check.md'), `---\n${JSON.stringify(schedule)}\n---\nCheck local state.\n`);
    const sessions = [];
    for (const title of ['Alpha', 'Beta', 'Gamma']) {
      sessions.push(await startSession({ root: h.root, title, brief: 'Inspect.', cwd: h.root }));
    }
    const pending = () => readdirSync(join(h.root, 'runtime/session-requests')).sort();
    const expected = sessions.map(session => `${session.name}.json`).sort();
    const routine = app.runner.trigger('check', 'first-routine');
    const overflow = [app.tickSessions(), app.tickSessions()];
    await Promise.all([routine, app.runner.tick()]);
    await started[0].promise;
    await app.runner.serialize(() => {});
    assert.deepEqual(pending(), expected, 'competing routine reserves before requests are consumed');
    assert.equal(calls.length, 1);
    assert.deepEqual(sessionsToPost(h.root), []);
    const log = readFileSync(join(h.root, 'runtime/handoffs/sessions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(log.filter(event => event.endedAt).length, 0, 'pending requests have no end record');
    assert.equal(Object.values((await app.runtime.state()).runs).filter(run => run.id.startsWith('session:')).length, 0);
    const routineWork = [...app.runner.jobs.values()][0];
    gates[0].resolve({ status: 'completed', text: 'Checked.' });
    await routineWork;
    await Promise.all(overflow);

    const first = app.tickSessions();
    const repeated = app.tickSessions();
    const competing = assert.rejects(app.runner.trigger('check', 'second-routine'), /capacity is full/);
    await Promise.all([app.runner.tick(), competing]);
    await started[1].promise;
    await app.runner.serialize(() => {});
    assert.deepEqual(pending(), expected.slice(1), 'only the first pending session is consumed');
    assert.equal(calls.length, 2, 'reentrant onTick and explicit calls cannot duplicate admission');
    assert.equal(app.runner.scheduledJobCount(await app.runtime.state()), 1);
    gates[1].resolve({ status: enabled ? 'failed' : 'completed', text: 'First outcome.' });
    await Promise.all([first, repeated]);

    const second = app.tickSessions();
    await started[2].promise;
    assert.deepEqual(pending(), expected.slice(2), 'completion or failure frees the next place');
    assert.equal(await app.runner.kill(`session:${sessions[1].name}`, { source: 'user', reason: 'Stop exact session.' }), true);
    await second;
    const third = app.tickSessions();
    await started[3].promise;
    assert.deepEqual(pending(), [], 'confirmed cancellation frees the next place');
    gates[3].resolve({ status: 'completed', text: 'Last outcome.' });
    await third;
    assert.equal(calls.length, 4);
    assert.equal(app.runner.scheduledJobCount(await app.runtime.state()), 0);
  });
}

test('a session `hobkin session` asked for runs as a job: it shows, streams, takes messages, and wakes its starter with the report', async t => {
  const h = fixture(t);
  const ready = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const heard = [];
  const app = await h.openApp({ intervalMs: 60000, runHarness: async (request, options) => {
    options.onReady(async message => { heard.push(message); });
    ready.resolve({ request, options });
    return finish.promise;
  } });
  t.after(() => { finish.resolve({ status: 'interrupted', text: '' }); return app.close(); });
  writeFileSync(join(h.root, 'AGENTS.md'), '# Hobkin directions\n\nThe user\'s own ask in chat is the yes.\n');
  const started = await startSession({ root: h.root, title: 'Review routines', brief: 'Review my routines.', wake: true, cwd: h.root, env: {} });

  const ended = app.tickSessions();
  const { request, options } = await ready.promise;
  const asked = JSON.parse(request.prompt);
  assert.equal(asked.task, `Read ${join(h.root, 'runtime', 'handoffs', `${started.name}.md`)} and follow it.`);
  assert.match(asked.directions, /The user's own ask in chat is the yes\.\n$/, 'the session follows the user\'s directions, as every job does');
  assert.equal(request.sessionFile, join(h.root, 'jobs', `${request.id}.jsonl`));
  assert.deepEqual(readdirSync(join(h.root, 'runtime', 'session-requests')), [], 'each request starts once');
  options.onEvent({ type: 'tool_execution_start', toolCallId: 'r', toolName: 'read', args: { path: 'routines.md' } });
  const live = await app.refresh();
  const run = live.runs.find(item => item.id === `session:${started.name}`);
  assert.deepEqual([run.state, run.kind, run.title, run.cwd], ['running', 'background', 'Review routines', h.root]);
  assert.equal(live.jobActivity[run.id][0].name, 'read');
  const noteId = '00000000-0000-4000-8000-000000000001';
  await app.runner.messageCheck({ scheduleId: `session.${started.name}`, runId: run.id, noteId, message: 'Also the weekly one.' });
  assert.equal(heard[0], `[hobkin-note:${noteId}]\nAlso the weekly one.`);
  options.onEvent({ type: 'message_end', message: { role: 'user', content: heard[0] } });
  const receiptView = await app.refresh();
  assert.deepEqual(receiptView.steeringReceipts[run.id].map(({ noteId }) => noteId), [noteId]);
  assert.deepEqual(Object.keys(receiptView.steeringReceipts[run.id][0]), ['noteId', 'at']);
  assert.doesNotMatch(JSON.stringify(receiptView), /Also the weekly one|hobkin-note/);
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(join(h.root, 'runtime/view.json'), 'utf8')), 'steeringReceipts'), false);

  finish.resolve({ status: 'completed', text: 'Useful: Two routines overlap.', cost: null });
  await ended;
  assert.equal(readFileSync(started.report, 'utf8'), 'Useful: Two routines overlap.', 'its last reply is the report it never wrote');
  assert.deepEqual(sessionsToWake(h.root).map(({ name, said }) => [name, said]), [[started.name, 'Useful: Two routines overlap.']]);
  assert.deepEqual(sessionsToPost(h.root), [], 'the run posts its own notice, so the session log does not post it twice');
});

test('a session runs on the model of the tier it was given: its own when set, the chat model for work, the checks model for fast', async t => {
  const h = fixture(t);
  h.config.concurrency = 4;
  // The fixture's chat runs on fixture/local at medium.
  Object.assign(h.config.background, { model: 'fixture/checks', effort: 'low' });
  atomicJson(join(h.root, 'config.json'), h.config);
  const seen = [];
  const app = await h.openApp({ intervalMs: 60000, runHarness: async request => { seen.push(request); return { status: 'completed', text: 'Done.', cost: null }; } });
  t.after(() => app.close());
  const ranOn = async (title, tier) => {
    const started = await startSession({ root: h.root, title, brief: 'Go.', cwd: h.root, approved: true, ...(tier ? { tier } : {}) });
    await app.tickSessions();
    const request = seen.at(-1);
    const run = (await app.runtime.state()).runs[`session:${started.name}`];
    assert.deepEqual([run.model, run.effort, run.tier], [request.model, request.effort, tier ?? 'mid'], 'the run keeps the tier beside what it meant');
    return [request.model, request.effort];
  };

  assert.deepEqual(await ranOn('Find usages', 'fast'), ['fixture/checks', 'low']);
  assert.deepEqual(await ranOn('Fix totals', 'mid'), ['fixture/local', 'medium']);
  assert.deepEqual(await ranOn('Rework billing', 'high'), ['fixture/local', 'medium']);
  assert.deepEqual(await ranOn('No tier named'), ['fixture/local', 'medium'], 'work that names no tier is ordinary work, never the checks model');

  // A tier the user sets while hobkin runs is used by the next job, with no restart.
  atomicJson(join(h.root, 'config.json'), { ...h.config, tiers: { high: { model: 'fixture/strong', effort: 'xhigh' } } });
  assert.deepEqual(await ranOn('Rework billing again', 'high'), ['fixture/strong', 'xhigh']);
  assert.deepEqual(await ranOn('Fix totals again', 'mid'), ['fixture/local', 'medium']);
});

test('Reports prefer a session run over its log fallback and retain distinct same-title fallback reports', { timeout: 10000 }, async t => {
  const h = fixture(t);
  const title = 'Repeated session title';
  const app = await h.openApp({ intervalMs: 60000, runHarness: async () => ({ status: 'failed', text: 'Run failure details.' }) });
  t.after(() => app.close());
  const started = await startSession({ root: h.root, title, brief: 'Inspect.', cwd: h.root });
  await app.tickSessions();
  const runId = `session:${started.name}`;
  const run = (await app.runtime.state()).runs[runId];
  assert.equal(run.status, 'failed');
  saveReport(h.root, runId, 'Run failure details.');

  const legacyName = 'hobkin-legacy-0001';
  const legacyReport = join(h.root, 'runtime', 'handoffs', `${legacyName}.report.md`);
  recordSessionStart(h.root, { name: legacyName, title, report: legacyReport });
  saveReport(h.root, `session:${legacyName}`, 'Legacy session report.');
  recordSessionEnd({ name: legacyName, report: legacyReport });

  const reports = (await app.refresh()).reports.filter(report => report.title === title);
  assert.deepEqual(reports.map(({ id }) => id).sort(), [runId, `session:${legacyName}`].sort());
  const failed = reports.find(({ id }) => id === runId);
  assert.deepEqual([failed.outcome, failed.at, failed.body], ['failed', run.finishedAt, 'Run failure details.']);
  const fallback = reports.find(({ id }) => id === `session:${legacyName}`);
  assert.deepEqual([fallback.outcome, fallback.body], ['completed', 'Legacy session report.']);
});

test('user Stop tells main once across busy wake, repeated stop and reconnect, retaining partial session output', { timeout: 10000 }, async t => {
  const h = fixture(t);
  h.config.concurrency = 1;
  atomicJson(join(h.root, 'config.json'), h.config);
  const ready = Promise.withResolvers();
  let app = await h.openApp({ intervalMs: 60000, runHarness: async ({ signal }) => {
    ready.resolve();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return { status: 'interrupted', text: 'Partial findings remain.' };
  } });
  try {
    const started = await startSession({ root: h.root, title: 'User-stopped review', brief: 'Review.', wake: true, cwd: h.root, env: {} });
    const ended = app.tickSessions();
    await ready.promise;
    const id = `session:${started.name}`;
    const main = h.fake.controls.get(h.fake.opened.at(-1));
    main.gate = Promise.withResolvers();
    main.started = Promise.withResolvers();
    await app.send('busy now');
    await main.started.promise;
    assert.equal(await app.kill(id), true);
    await ended;
    assert.equal(await app.kill(id), false);
    const run = (await app.runtime.state()).runs[id];
    assert.equal(run.userStop.source, 'user');
    assert.equal(run.result.text, 'Partial findings remain.');
    assert.equal(readFileSync(started.report, 'utf8'), 'Partial findings remain.');
    assert.match(sessionsToWake(h.root)[0].said, /user stopped.*session:.*Do not retry or restart/i);
    app.tickWakes();
    const queued = app.send('after stop');
    main.gate.resolve();
    await app.runtime.idle();
    await queued;
    await app.runtime.idle();
    const texts = () => app.runtime.messages().filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : m.content.filter(p => p.type === 'text').map(p => p.text).join(''));
    assert.match(texts()[1], /user stopped.*session:/i, 'queued user message carries stop context even before wake');
    assert.match(texts()[1], /Do not retry or restart/);
    const send = app.runtime.send.bind(app.runtime);
    app.runtime.send = async () => { throw Error('Wake not accepted.'); };
    await app.tickWakes();
    assert.equal(sessionsToWake(h.root).length, 1, 'rejected wake remains due');
    app.runtime.send = send;
    await Promise.all([app.tickWakes(), app.tickWakes()]);
    await app.runtime.idle();
    assert.equal(texts().length, 3, 'only the already-requested wake adds a turn');
    assert.match(texts()[2], /user stopped.*session:.*Do not retry or restart/i);
    assert.deepEqual(sessionsToWake(h.root), []);
    await app.close();
    app = await h.openApp({ intervalMs: 60000 });
    await app.tickWakes();
    await app.runtime.idle();
    assert.equal(texts().length, 3, 'reconnect does not repeat the requested wake');
  } finally { await app.close(); }
});

for (const wake of [true, false]) {
  test(`confirmed Stop keeps ${wake ? 'requested wake' : 'next user message'} admission and notice`, { timeout: 10000 }, async t => {
    const h = fixture(t);
    const ready = Promise.withResolvers();
    const app = await h.openApp({ intervalMs: 60000, runHarness: async ({ signal }) => {
      ready.resolve();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      return { status: 'interrupted', text: 'Partial result.' };
    } });
    t.after(() => app.close());
    const started = await startSession({ root: h.root, title: 'Stopped exact job', brief: 'Inspect.', wake, cwd: h.root, env: {} });
    const ended = app.tickSessions();
    await ready.promise;
    const id = `session:${started.name}`;
    assert.equal(await app.runner.kill(id, { source: 'user', reason: 'Stop this expensive review.' }), true);
    await ended;
    const send = app.runtime.send.bind(app.runtime);
    app.runtime.send = async () => { throw Error('Not admitted.'); };
    await app.tickWakes();
    assert.equal(cardActionsToTell(h.root).filter(action => action.userStop?.runId === id).length, 1);
    assert.equal(sessionsToWake(h.root).length, wake ? 1 : 0);
    assert.equal(app.runtime.messages().length, 0);
    app.runtime.send = send;
    await Promise.all([app.tickWakes(), app.tickWakes()]);
    if (!wake) {
      assert.equal(app.runtime.messages().length, 0, 'a nonwake Stop cannot start a turn');
      await app.send('What happened?');
    }
    await app.runtime.idle();
    assert.equal(cardActionsToTell(h.root).filter(action => action.userStop?.runId === id).length, 0);
    const messages = app.runtime.messages().filter(message => message.role === 'user');
    assert.equal(messages.length, 1);
    assert.ok(JSON.stringify(messages[0]).includes(id));
    assert.match(JSON.stringify(messages[0]), /Stop this expensive review\..*Do not retry or restart/);
    await app.tickWakes();
    await app.runtime.idle();
    assert.equal(app.runtime.messages().filter(message => message.role === 'user').length, 1);
  });
}

test('user Stop distinguishes confirmed cancellation, normal-completion race, and internal shutdown; rejected main sends retain notice', { timeout: 10000 }, async t => {
  const h = fixture(t);
  h.config.concurrency = 1;
  atomicJson(join(h.root, 'config.json'), h.config);
  let app = await h.openApp({ intervalMs: 60000 });
  t.after(() => app.close());
  for (const [id, status, user] of [['scheduled:one', 'interrupted', true], ['session:raced', 'completed', true], ['work:guard', 'interrupted', false]]) {
    const ready = Promise.withResolvers();
    const { work } = app.runner.startTracked({ id, kind: 'background', scheduleId: 'check', title: id }, async signal => {
      ready.resolve();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      return { status, text: 'Preserved partial output.' };
    });
    await ready.promise;
    const first = user ? app.kill(id) : app.runner.kill(id);
    const repeated = user ? app.kill(id) : app.runner.kill(id);
    assert.equal(await first, status === 'interrupted');
    assert.equal(await repeated, false);
    await work;
    assert.equal(await app.kill(id), false);
  }
  await app.close();
  app = await h.openApp({ intervalMs: 60000 });
  const realSend = app.runtime.send.bind(app.runtime);
  app.runtime.send = async () => { throw Error('Message rejected before submission.'); };
  await assert.rejects(app.send('first try'), /rejected/);
  app.runtime.send = realSend;
  await app.send('second try');
  await app.runtime.idle();
  await app.send('third try');
  await app.runtime.idle();
  const messages = app.runtime.messages().filter(m => m.role === 'user');
  const first = JSON.stringify(messages[0]);
  assert.match(first, /scheduled:one/);
  assert.match(first, /Do not retry or restart/);
  assert.doesNotMatch(first, /session:raced|work:guard/, 'race and guard are not confirmed user stops');
  assert.doesNotMatch(JSON.stringify(messages[1]), /scheduled:one/);
});

test('confirmed Stop recovers missing notices on open without reviving heard or abandoned intents', async t => {
  const h = fixture(t);
  let app = await h.openApp({ intervalMs: 60000 });
  t.after(() => app.close());
  await app.runtime.change(state => {
    for (const id of ['missing', 'heard', 'abandoned', 'pending', 'internal', 'completed', 'mismatch']) {
      state.runs[id] = { id, kind: 'background', title: id, status: 'interrupted', result: { status: 'interrupted', text: 'Partial output.' }, userStop: { source: 'user', reason: 'Enough reviewing.' } };
    }
    delete state.runs.abandoned.result;
    Object.assign(state.runs.pending, { status: 'running', result: undefined });
    delete state.runs.internal.userStop;
    state.runs.completed.status = state.runs.completed.result.status = 'completed';
    state.runs.mismatch.result.status = 'completed';
  });
  markCardActionsHeard(h.root, [{ id: 'user-stop:heard' }]);
  await app.close();
  app = await h.openApp({ intervalMs: 60000 });
  assert.deepEqual(allCardActions(h.root).map(action => action.id).sort(), ['user-stop:heard', 'user-stop:missing']);
  assert.deepEqual(cardActionsToTell(h.root).map(action => action.id), ['user-stop:missing']);
  assert.match(allCardActions(h.root).find(action => action.id === 'user-stop:heard').did, /heard.*Enough reviewing\..*Do not retry or restart/);
  assert.equal((await app.runtime.state()).runs.missing.result.text, 'Partial output.');
  await app.send('Continue the conversation.');
  await app.runtime.idle();
  assert.match(JSON.stringify(app.runtime.messages()), /missing.*Enough reviewing\..*Do not retry or restart/);
  const log = readFileSync(join(h.root, 'work/card-actions.jsonl'), 'utf8');
  await app.close();
  app = await h.openApp({ intervalMs: 60000 });
  assert.deepEqual(cardActionsToTell(h.root), []);
  assert.equal(readFileSync(join(h.root, 'work/card-actions.jsonl'), 'utf8'), log);
});

test('owned-publication application publishes terminal and unknown descendants after parent feed release', async t => {
  const root = mkdtempSync(join(tmpdir(), 'owned-publication-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root });
  const runtime = new HobkinRuntime(root, config, { ownedLifecycle: { snapshot: () => [
    { id: 'child', parentId: 'job', rootId: 'job', depth: 1, name: 'same', status: 'completed' },
    { id: 'grandchild', parentId: 'child', rootId: 'job', depth: 2, name: 'same', status: 'unknown' },
  ] } });
  assert.equal(typeof runtime.jobChildren, 'function');
  runtime.ownedActivity.track('job'); runtime.ownedActivity.settle('job');
  const app = new HobkinApplication();
  app.runtime = runtime; app.snapshot = {};
  app.jobActivity.set('job', { snapshot: () => [{ kind: 'assistant', text: 'Full parent content' }] });
  app.publishActivity();
  assert.equal(app.snapshot.jobActivity.job[0].text, 'Full parent content');
  app.jobActivity.clear();
  app.publishActivity(); app.publishActivity();
  assert.deepEqual(app.snapshot.jobChildren.job.map(({ id, parentId, state }) => [id, parentId, state]),
    [['child', 'job', 'completed'], ['grandchild', 'child', 'unknown']]);
  assert.deepEqual(app.snapshot.mainChildren, []);
  runtime.main = { model: { provider: 'fixture', id: 'local' }, thinkingLevel: 'medium' };
  runtime.state = async () => ({ runs: { job: { id: 'job', kind: 'background', status: 'completed', result: { text: 'Done.' } } } });
  app.config = config; app.snapshot.history = { reports: [] }; app.noticeRunIds = new Set();
  app.delivery = { syncEvidence: async () => {} };
  app.runner = { snapshot: async () => ({ schedules: [], errors: [] }), steeringReceipts: () => ({}) };
  app.learner = { takePost: () => null }; app.ledger = { sync: () => ({}) };
  app.telemetry = { attention: () => [] }; app.now = () => 0;
  app.workView = () => ({ harnessLines: [], folderLines: [], discovery: {} });
  app.moods = { observe() {}, reaction: {} };
  app.templatesLooked = true; app.uploadLooked = true;
  app.yesterdayWins = () => null; app.waitingNow = () => ({}); app.winsToday = () => null;
  const projected = await app.project();
  assert.deepEqual(projected.jobChildren, app.snapshot.jobChildren);
  assert.deepEqual(projected.jobChildren.job.map(row => row.state), ['completed', 'unknown']);
  assert.deepEqual(projected.jobActivity, {});
});

for (const status of ['completed', 'failed', 'interrupted']) {
  for (const publishedWhileRunning of [true, false]) {
    test(`${status} activity publishes once when the job ends ${publishedWhileRunning ? 'after' : 'before'} its first refresh`, async t => {
      const h = fixture(t);
      const app = await h.openApp({ intervalMs: 60000 });
      t.after(() => app.close());
      clearTimeout(app.refreshTimer);
      app.refreshTimer = null;
      app.requestRefresh = () => {}; // Keep the terminal events in one projection, independent of timer timing.
      const published = [];
      app.onChange = view => published.push(view);
      await app.runtime.admit({ id: 'ending', kind: 'background', scheduleId: 'check', title: 'Check' });
      app.observeActivity('ending', { type: 'message_start', message: { role: 'assistant', content: [] } });
      app.observeActivity('ending', { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Draft' } });
      app.observeActivity('ending', { type: 'tool_execution_start', toolCallId: 'read', toolName: 'read', args: { path: 'fixture.txt' } });
      if (publishedWhileRunning) {
        const live = await app.refresh();
        assert.equal(live.jobActivity.ending[0].text, 'Draft');
        assert.equal(live.jobActivity.ending[1].state, 'running');
      }
      app.observeActivity('ending', {
        type: 'tool_execution_end', toolCallId: 'read', toolName: 'read', isError: status === 'failed',
        result: { content: [{ type: 'text', text: 'Final tool output\n' }] },
      });
      app.observeActivity('ending', { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Final assistant text\n' }] } });
      await app.runtime.finish('ending', { status, text: 'Useful: Fixture report.' });
      const terminal = await app.refresh();
      // Each entry says when hobkin first saw it (`cli-job-activity.test.mjs`).
      assert.ok(terminal.jobActivity.ending.every(entry => Number.isFinite(entry.at)));
      assert.deepEqual(terminal.jobActivity.ending.map(({ at, ...entry }) => entry), [
        { id: 'message:1:0', kind: 'assistant', text: 'Final assistant text\n' },
        { id: 'tool:read', kind: 'tool', name: 'read', state: status === 'failed' ? 'failed' : 'completed', input: '{\n  "path": "fixture.txt"\n}', output: 'Final tool output\n' },
      ]);
      assert.equal(terminal.runs.find(run => run.id === 'ending').state, status);
      assert.equal(published.at(-1), terminal);
      assert.equal(app.jobActivity.size, 0);
      assert.deepEqual((await app.refresh()).jobActivity, {});
      assert.equal(published.filter(view => view.jobActivity.ending?.[0].text === 'Final assistant text\n').length, 1);
      const saved = JSON.parse(readFileSync(join(h.root, 'runtime/view.json'), 'utf8'));
      assert.equal(Object.hasOwn(saved, 'jobActivity'), false);
      assert.doesNotMatch(JSON.stringify(await app.runtime.state()), /Final tool output|Final assistant text/);
    });
  }
}

test('event refresh during projection gets a follow-up instead of joining stale work', async t => {
  const app = Object.create(HobkinApplication.prototype);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const delivered = Promise.withResolvers();
  app.runner = {};
  let calls = 0;
  app.project = async () => {
    calls++;
    if (calls === 1) {
      entered.resolve();
      await release.promise;
    } else {
      delivered.resolve();
    }
  };
  const first = app.refresh();
  await entered.promise;
  app.requestRefresh();
  await new Promise(resolve => setTimeout(resolve, 40));
  release.resolve();
  await first;
  const lostRefresh = new Promise((_, reject) => {
    setTimeout(() => reject(Error('lost refresh')), 200);
  });
  await Promise.race([delivered.promise, lostRefresh]);
  assert.equal(calls, 2);
});

test('maximum-size reports stay file-backed outside the dashboard cache and are not replayed', { timeout: 10000 }, async t => {
  const h = fixture(t);
  const body = 'x'.repeat(16777216);
  const app = await h.openApp({ intervalMs: 60000 });
  t.after(async () => app.close());
  await app.runtime.admit({ id: 'large-report', kind: 'background', title: 'Large report' });
  await app.runtime.finish('large-report', { status: 'completed', text: body });
  assert.equal((await app.refresh()).reports.find(report => report.id === 'large-report').body, body);
  assert.equal(readFileSync(join(h.root, 'reports', readdirSync(join(h.root, 'reports'))[0]), 'utf8'), body);
  await app.close();
  assert.doesNotThrow(() => readLocalView(h.root));
  assert.ok(statSync(join(h.root, 'runtime/view.json')).size <= 16777216);
  assert.equal(readLocalView(h.root).reports.find(report => report.id === 'large-report').body, body);
  let calls = 0;
  const reopened = await h.openApp({ intervalMs: 60000, runHarness: async () => { calls++; throw Error('Unexpected report replay.'); } });
  t.after(async () => reopened.close());
  assert.equal((await reopened.refresh()).reports.find(report => report.id === 'large-report').body, body);
  assert.equal((await reopened.runtime.state()).runs['large-report'].status, 'completed');
  assert.equal(calls, 0);
  await reopened.close();
  assert.equal(calls, 0);
});

test('deleted reports leave the live view, the saved view and restarts while run receipts stay', async t => {
  const h = fixture(t);
  const imported = {
    id: 'imported:old',
    title: 'Imported',
    body: 'Old',
    at: '2025-12-01T00:00:00Z',
    outcome: 'imported',
    origin: 'legacy-state',
    path: '/prior/report.json',
  };
  atomicJson(join(h.root, 'runtime/imported-reports.json'), { version: 1, reports: [imported] });
  const oldRun = 'weekly-check:2026-01-02';
  const newRun = 'weekly-check:2026-01-09';

  const app = await h.openApp();
  try {
    await app.runtime.change(state => {
      state.runs[oldRun] = backgroundRun(oldRun, { scheduleId: 'weekly-check' });
      state.runs[newRun] = backgroundRun(newRun, { scheduleId: 'weekly-check' });
    });
    const before = await app.refresh();
    assert.equal(before.reports.find(report => report.id === newRun).scheduleId, 'weekly-check');
    saveReport(h.root, oldRun, '# Old report');

    deleteReports(h.root, [oldRun, 'imported:old']);

    const after = await app.refresh();
    assert.deepEqual(after.reports.map(report => report.id), [newRun]);
    assert.ok((await app.runtime.state()).runs[oldRun]);
  } finally {
    await app.close();
  }
  assert.deepEqual(readLocalView(h.root).reports.map(report => report.id), [newRun]);
  assert.deepEqual(readdirSync(join(h.root, 'reports')), []);
});

test('a deletion from another process recounts the running view without a state change', async t => {
  const h = fixture(t);
  const recounted = Promise.withResolvers();
  let deleted = false;
  const app = await h.openApp({
    onChange: view => {
      if (deleted && view.reports.length === 0) recounted.resolve();
    },
  });
  try {
    await app.runtime.change(state => {
      state.runs['daily-check:2026-01-02'] = backgroundRun('daily-check:2026-01-02');
    });
    assert.equal((await app.refresh()).reports.length, 1);
    await new Promise(resolve => setTimeout(resolve, 100));

    deleteReports(h.root, ['daily-check:2026-01-02']);
    deleted = true;

    const timeout = setTimeout(() => recounted.reject(Error('View was not recounted.')), 2000);
    await recounted.promise.finally(() => clearTimeout(timeout));
  } finally {
    await app.close();
  }
});

test('the live view carries memory size and report attention, and reads reach telemetry', async t => {
  const h = fixture(t);
  writeFileSync(join(h.root, 'memory.md'), '- Rent is due\n');
  mkdirSync(join(h.root, 'checks/check'), { recursive: true });
  writeFileSync(join(h.root, 'checks/check/memory.md'), 'x'.repeat(1000));

  assert.equal(readLocalView(h.root).memoryBytes, 1014);
  const app = await h.openApp();
  try {
    assert.equal((await app.refresh()).memoryBytes, 1014);
    await app.runtime.change(state => {
      state.runs['run-1'] = {
        id: 'run-1', kind: 'background', scheduleId: 'check', title: 'Check', status: 'completed',
        finishedAt: new Date(Date.now() + 1000).toISOString(), result: { status: 'completed', text: 'Useful: Found it.' },
      };
    });
    app.recordReportRead({ id: 'run-1', dwellMs: 20000 });

    const view = await app.refresh();
    assert.deepEqual(view.reportAttention.map(({ scheduleId, reports, read }) => [scheduleId, reports, read]), [['check', 1, 1]]);
    assert.match(readFileSync(join(h.root, 'runtime/telemetry.jsonl'), 'utf8'), /report_read/);
    assert.equal(view.reports.find(({ id }) => id === 'run-1').readState, 'read');
    assert.equal(readLocalView(h.root).reports.find(({ id }) => id === 'run-1').readState, 'read');
  } finally {
    await app.close();
  }
});

test('a message about a report gives the model the report and shows the chat only what was typed', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  const report = { id: 'run-1', title: 'Email follow-ups', at: '2026-10-30T15:01:00Z', body: 'Critical: the smart host rejected 25 messages.' };
  try {
    await app.send('what should I check first?', report);
    await app.runtime.idle();

    const sentToModel = app.runtime.messages().find(message => message.role === 'user').content;
    assert.match(sentToModel, /smart host rejected 25 messages/);
    assert.match(sentToModel, /what should I check first\?$/);

    const view = await app.refresh();
    const shown = view.messages.find(message => message.role === 'user');
    assert.equal(shown.content, 'what should I check first?');
    assert.equal(shown.about, 'Email follow-ups');
    assert.match(readFileSync(join(h.root, 'runtime/telemetry.jsonl'), 'utf8'), /report_discussed/);
  } finally {
    await app.close();
  }
});

const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];

test('a finished branch files no question of its own, so nothing opens for it', async t => {
  const h = fixture(t);
  const asked = [];
  const app = await h.openApp({ askQuestion: async request => { asked.push(request); return null; } });
  try {
    chooseProject(h.root, '/repos/api', 'important');
    await app.director.onDraftDone({ slug: 'api', id: 'abc', project: 'api', title: 'Fix login' });
    await app.presentDecision();

    assert.deepEqual(asked, []);
    assert.deepEqual(openDecisions(h.root), []);
  } finally {
    await app.close();
  }
});

test('a question filed while the user is away waits for them, and after ten minutes goes to Decisions without opening', async t => {
  const h = fixture(t);
  const asked = [];
  const clock = { at: Date.parse('2026-06-01T12:00:00Z') };
  const app = await h.openApp({
    now: () => clock.at,
    presence: () => ({ seenAt: clock.at - 3 * 3600000, away: true, occupied: false }),
    askQuestion: async request => { asked.push(request); return null; },
  });
  try {
    const { id } = fileDecision(h.root, { from: 'Routine mail', question: 'Reply to the bank?', choices: yesNo }, clock.at);
    await app.presentDecision();
    assert.equal(openDecisions(h.root)[0].shown, false);

    clock.at += 10 * 60000;
    await app.presentDecision();

    assert.deepEqual(asked, []);
    assert.deepEqual(openDecisions(h.root).map(decision => [decision.id, decision.shown]), [[id, true]]);
  } finally {
    await app.close();
  }
});

test('parking a question nobody saw never throws from the tick, even when the screen cannot refresh', async t => {
  const h = fixture(t);
  const clock = { at: Date.parse('2026-06-01T12:00:00Z') };
  const app = await h.openApp({ now: () => clock.at, presence: () => ({ seenAt: clock.at - 3 * 3600000, away: true, occupied: false }) });
  try {
    fileDecision(h.root, { from: 'Routine mail', question: 'Reply to the bank?', choices: yesNo }, clock.at);
    clock.at += 10 * 60000;
    app.refresh = async () => { throw Error('The view cannot be written.'); };

    await assert.doesNotReject(app.presentDecision());

    assert.equal(openDecisions(h.root)[0].shown, true);
  } finally {
    delete app.refresh;
    await app.close();
  }
});

test('a question on screen has a row for the user\'s own words, and their words reach whoever asked', async t => {
  const h = fixture(t);
  const asked = [];
  const app = await h.openApp({ askQuestion: async request => { asked.push(request); return { typed: 'only if it is under $50' }; } });
  try {
    fileDecision(h.root, { from: 'Routine mail', question: 'Pay the bank fee?', choices: yesNo, answerTo: { kind: 'routine', id: 'mail' } });
    await app.presentDecision();

    assert.equal(asked[0].other, true);
    assert.deepEqual(openDecisions(h.root), []);
    assert.match(openCheck(h.root, 'mail').memory.text, /in their own words: only if it is under \$50/);
  } finally {
    await app.close();
  }
});

test('their own words to one of hobkin\'s own questions go to the main agent with the question, in Chat', async t => {
  const h = fixture(t);
  const shown = [];
  const app = await h.openApp({ showRow: target => shown.push(target), askQuestion: async () => ({ typed: 'start only the finboard one' }) });
  try {
    fileDecision(h.root, {
      key: 'pickup',
      from: 'Work mode',
      question: 'Work mode is on, and nothing new starts by itself. Next in the queue:\n1. P0 finboard: Fix totals',
      choices: [{ value: 'later', label: 'Not now' }, { value: 'these', label: 'Start it' }],
      answerTo: { kind: 'pickup', keys: ['item:finboard:a1'] },
    });
    await app.presentDecision();
    await app.outgoing;
    await app.runtime.idle();

    const sent = app.runtime.messages().find(message => message.role === 'user').content;
    assert.match(sent, /^<hobkin-report>\n/);
    assert.match(sent, /Next in the queue:\n1\. P0 finboard: Fix totals\n\n- Not now\n- Start it/);
    assert.match(sent, /start only the finboard one$/);
    assert.deepEqual(shown, [{ tab: 'chat' }]);
    assert.deepEqual(openDecisions(h.root), []);
  } finally {
    await app.close();
  }
});

test('a question left for 30 seconds stays in Action Items and is not shown again', async t => {
  const h = fixture(t);
  const asked = [];
  const app = await h.openApp({ askQuestion: async request => { asked.push(request); return null; } });
  try {
    const { id } = fileDecision(h.root, { from: 'Routine mail', question: 'Reply to the bank?', choices: yesNo });

    await app.presentDecision();
    await app.presentDecision();

    assert.equal(asked.length, 1);
    assert.deepEqual(openDecisions(h.root).map(decision => [decision.id, decision.shown]), [[id, true]]);
    assert.equal(app.snapshot.decisions.length, 1);
  } finally {
    await app.close();
  }
});

test('a question that cannot open is tried again, and goes to the tab once its 30 seconds are up', async t => {
  const h = fixture(t);
  let tried = 0;
  const clock = { at: Date.parse('2026-06-01T12:00:00Z') };
  const app = await h.openApp({ now: () => clock.at, askQuestion: async () => { tried += 1; return undefined; } });
  try {
    fileDecision(h.root, { from: 'Routine mail', question: 'Reply to the bank?', choices: yesNo }, clock.at);

    await app.presentDecision();
    assert.equal(openDecisions(h.root)[0].shown, false);

    clock.at += 30000;
    await app.presentDecision();

    assert.equal(tried, 2);
    assert.equal(openDecisions(h.root)[0].shown, true);
  } finally {
    await app.close();
  }
});

test('an answer reaches a routine in its memory, and a work item as its next run', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    chooseProject(h.root, '/repos/api', 'important');
    const { id: item } = fileItem(h.root, 'api', { key: 'fix', kind: 'fix', title: 'Fix login', brief: 'Evidence, who benefits, the first change, the proof.' });
    updateItem(h.root, 'api', item, { state: 'branch', branch: 'hobkin/login' });
    const forRoutine = fileDecision(h.root, { from: 'Routine mail', question: 'Reply to the bank?', choices: yesNo, answerTo: { kind: 'routine', id: 'mail' } });
    const forWork = fileDecision(h.root, { from: 'Work mode', question: 'Delete the old table?', choices: yesNo, answerTo: { kind: 'work', slug: 'api', item } });

    await app.workAction('decide', forRoutine.id, 'yes');
    await app.workAction('decide', forWork.id, 'no');

    assert.match(JSON.stringify(openCheck(h.root, 'mail').memory), /Reply to the bank\? They answered: Yes/);
    const [worked] = readItems(h.root, 'api');
    assert.equal(worked.state, 'open');
    assert.match(worked.workNote, /Delete the old table\? They answered: No/);
    assert.deepEqual(openDecisions(h.root), []);
  } finally {
    await app.close();
  }
});

test('turning work mode on without auto-pick asks what to start, and the answer comes back as its reply', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    chooseProject(h.root, '/repos/api', 'important');
    fileItem(h.root, 'api', { key: 'fix', kind: 'fix', title: 'Fix login', brief: 'Evidence, who benefits, the first change, the proof.' });
    writeMode(h.root, { autoPick: false });

    await app.workAction('start', h.root);

    const pickUp = openDecisions(h.root).find(({ key }) => key === 'pickup');
    assert.match(pickUp.question, /nothing new starts by itself/);
    const answer = await app.workAction('decide', pickUp.id, 'later');
    assert.match(answer.message, /Nothing new starts until you pick/);
    assert.equal(openDecisions(h.root).some(({ key }) => key === 'pickup'), false);
  } finally {
    await app.close();
  }
});

const HOUR_MS = 3600000;
const iso = time => new Date(time).toISOString();
const pileUp = (root, count, at) => {
  for (let index = 0; index < count; index += 1) {
    const { id } = fileDecision(root, { from: 'Routine mail', question: `Question ${index}?`, choices: yesNo, answerTo: { kind: 'routine', id: 'mail' } }, at);
    markShown(root, id);
  }
};
const briefApp = (h, clock, options = {}) => h.openApp({
  now: () => clock.at,
  intervalMs: HOUR_MS,
  presence: () => ({ seenAt: clock.at, away: false, occupied: false }),
  ...options,
});
const offersIn = view => view.messages.filter(({ id }) => id?.startsWith('notice:brief:'));
const OFFER = "It's been a while. While you were away: 3 decisions. Want a brief? Just say: brief me";

test('back after a while to what came in, Chat offers a brief once, in a line that asks nothing', async t => {
  const h = fixture(t);
  const clock = { at: Date.parse('2026-11-05T08:00:00Z') };
  writeBriefState(h.root, { lastSeenAt: iso(clock.at) });
  pileUp(h.root, 3, clock.at + HOUR_MS);
  clock.at += 3 * HOUR_MS;
  const app = await briefApp(h, clock);
  try {
    app.lookForReturn();
    clock.at += 60000;
    app.lookForReturn();
    const offers = offersIn(await app.refresh());

    assert.deepEqual(offers.map(({ role, content }) => [role, content]), [['notice', OFFER]]);
    assert.equal(openDecisions(h.root).length, 3);
    assert.equal(readBriefState(h.root).lastSeenAt, iso(clock.at));
  } finally {
    await app.close();
  }
});

test('no offer for a user who stayed, while they are still away, or for too little', async t => {
  const h = fixture(t);
  const clock = { at: Date.parse('2026-11-05T08:00:00Z') };
  const presence = { value: { seenAt: clock.at, away: false, occupied: false } };
  const app = await briefApp(h, clock, { presence: () => presence.value });
  try {
    app.lookForReturn();
    pileUp(h.root, 5, clock.at + 60000);
    clock.at += HOUR_MS;
    presence.value = { seenAt: clock.at, away: false, occupied: false };
    app.lookForReturn();

    clock.at += 3 * HOUR_MS;
    presence.value = { seenAt: clock.at - 3 * HOUR_MS, away: true, occupied: false };
    app.lookForReturn();

    pileUp(h.root, 2, clock.at - HOUR_MS);
    presence.value = { seenAt: clock.at, away: false, occupied: false };
    app.lookForReturn();

    assert.equal(readBriefState(h.root).offer, null);
    assert.deepEqual(offersIn(await app.refresh()), []);
  } finally {
    await app.close();
  }
});

test('when the user was last here survives a restart, so opening hobkin hours later offers the brief', async t => {
  const h = fixture(t);
  const clock = { at: Date.parse('2026-11-05T08:00:00Z') };
  const first = await briefApp(h, clock);
  first.lookForReturn();
  await first.close();

  pileUp(h.root, 3, clock.at + HOUR_MS);
  clock.at += 10 * HOUR_MS;
  const second = await briefApp(h, clock);
  try {
    second.lookForReturn();

    assert.deepEqual(offersIn(await second.refresh()).map(({ content }) => content), [OFFER]);
  } finally {
    await second.close();
  }
});

test('brief me reaches the main agent with the brief ahead of the words, and Chat shows only the words', async t => {
  const h = fixture(t);
  const clock = { at: Date.parse('2026-11-05T08:00:00Z') };
  writeBriefState(h.root, { offer: { since: iso(clock.at), at: iso(clock.at + 2 * HOUR_MS), line: OFFER } });
  const { id } = fileDecision(h.root, { from: 'Routine mail', question: 'Archive the old invoices?', choices: yesNo, answerTo: { kind: 'routine', id: 'mail' } }, clock.at + HOUR_MS);
  clock.at += 2 * HOUR_MS;
  const app = await briefApp(h, clock);
  try {
    app.snapshot.reports = [{ id: 'rent:1', title: 'Rent', scheduleId: 'rent', at: iso(clock.at - HOUR_MS), outcome: 'completed', body: 'Useful: Rent is due Friday.\n\nNext: Pay it.' }];
    await app.send('brief me');
    await app.runtime.idle();

    const sent = app.runtime.messages().find(message => message.role === 'user').content;
    const [, json] = sent.match(/<hobkin-brief>\n(.*)\n<\/hobkin-brief>\n\nbrief me$/);
    const material = JSON.parse(json);
    assert.equal(material.since, iso(clock.at - 2 * HOUR_MS));
    assert.deepEqual(material.decisions.map(({ id: decision, choices }) => [decision, choices.length]), [[id, 2]]);
    assert.deepEqual(material.reports.map(({ id: report, next }) => [report, next]), [['rent:1', 'Pay it.']]);
    assert.match(material.guide, /prompts\/humanizer\.md$/);
    assert.equal(readBriefState(h.root).briefedAt, iso(clock.at));
    const chat = (await app.refresh()).messages.find(message => message.role === 'user');
    assert.equal(chat.content, 'brief me');
  } finally {
    await app.close();
  }
});

test('the view carries every row Decisions lists', async t => {
  const h = fixture(t);
  chooseProject(h.root, '/repos/api', 'important');
  const { id } = fileItem(h.root, 'api', { key: 'keys', kind: 'fix', title: 'Rotate the keys', brief: 'The first change.' });
  updateItem(h.root, 'api', id, { state: 'done', left: 'Rotate the keys at the provider.' });
  const app = await h.openApp();
  try {
    const { waiting } = await app.refresh();

    assert.deepEqual(waiting.yours.map(({ item, reason }) => [item, reason]), [[id, 'Rotate the keys at the provider.']]);
    assert.deepEqual(waiting.branches, []);
  } finally {
    await app.close();
  }
});

test('after an update, Chat says once which routine templates are new', async t => {
  const h = fixture(t);
  const { templates } = listTemplates(h.root);
  const before = templates.filter(({ id }) => id !== 'important-dates').map(({ id, version }) => [id, version]);
  atomicJson(join(h.root, 'runtime', 'templates-seen.json'), { version: 1, seen: Object.fromEntries(before) });
  const told = view => view.messages.filter(({ role, content }) => role === 'notice' && /routine template/.test(content));

  let app = await h.openApp();
  try {
    const [notice, ...again] = told(await app.refresh());
    assert.deepEqual(again, []);
    assert.match(notice.content, /Important dates\. Each waits in Action Items/);
    assert.deepEqual(openDecisions(h.root).map(({ tldr, choices }) => [tldr, choices.map(({ value }) => value)]), [['Try the Important dates template', ['try', 'no']]]);
  } finally {
    await app.close();
  }
  app = await h.openApp();
  try {
    assert.equal(told(await app.refresh()).length, 1, 'the next open says nothing new');
  } finally {
    await app.close();
  }
});

test('a learning proposal answered in Action Items is recorded at once, and a yes asks the main agent for the plan', async t => {
  const h = fixture(t);
  setLearning(h.root, true);
  const proposal = { id: 'abc123', scope: 'mail', kind: 'rethink', title: 'Mail', code: 'blocked', seen: 6, runs: 8, days: 8, latest: '2026-01-02T00:00:00.000Z', at: '2026-01-02T00:00:00.000Z' };
  const shown = [];
  const app = await h.openApp({ intervalMs: HOUR_MS, showRow: target => shown.push(target) });
  try {
    // Learning works its proposals out from runs as hobkin opens, and only again once something moves, so these go in after that pass.
    await app.learn();
    saveState(h.root, { lessons: [], proposals: [proposal, { ...proposal, id: 'def456', scope: 'news', title: 'News' }], pullRequests: {} });
    const { waiting } = await app.refresh();
    assert.deepEqual(waiting.proposals.map(({ id }) => id), ['abc123', 'def456']);
    assert.match(waiting.proposals[0].question, /^Mail: .+\. Rethink it\?$/);

    await app.workAction('learning', 'def456', 'no');
    await app.workAction('learning', 'abc123', 'yes');
    await app.outgoing;
    await app.runtime.idle();

    assert.deepEqual(readActions(h.root).answers.map(({ id, answer }) => [id, answer]), [['def456', 'no'], ['abc123', 'yes']]);
    assert.deepEqual((await app.refresh()).waiting.proposals, []);
    const sent = app.runtime.messages().find(message => message.role === 'user').content;
    assert.match(sent, /Mail: .+\. Rethink it\?/);
    assert.match(sent, /Yes, plan it\.$/);
    assert.deepEqual(shown, [{ tab: 'chat' }]);
    await assert.rejects(app.workAction('learning', 'abc123', 'yes'), /already answered/);
  } finally {
    await app.close();
  }
});

test('an action item done or turned down closes, and its routine hears, while doing it with hobkin keeps it open and hands it to the main agent', async t => {
  const h = fixture(t);
  const filed = title => fileActionItem(h.root, { key: title, from: 'Routine quality', title, detail: `${title}, on the payments dashboard.`, answerTo: { kind: 'action', id: 'quality' }, links: [{ label: 'Dashboard', url: 'https://example.com/d' }] }).id;
  const [done, dropped, helped] = ['Count failed retries', 'Alert on refunds', 'Graph the queue'].map(filed);
  const shown = [];
  const app = await h.openApp({ intervalMs: HOUR_MS, showRow: target => shown.push(target) });
  try {
    await app.workAction('decide', done, 'done');
    await app.workAction('decide', dropped, 'drop');
    const handed = await app.workAction('decide', helped, 'hobkin');
    const again = await app.workAction('decide', helped, 'hobkin');
    await app.outgoing;
    await app.runtime.idle();

    assert.match(handed.message, /stays in Action Items/);
    assert.match(again.message, /already has it/);
    assert.equal(app.runtime.messages().filter(message => message.role === 'user').length, 1, 'a second press sends nothing more');
    const [open, ...rest] = openDecisions(h.root);
    assert.deepEqual([open.id, rest], [helped, []]);
    assert.ok(open.handedAt);
    const sent = app.runtime.messages().find(message => message.role === 'user').content;
    assert.match(sent, /Routine quality: Graph the queue\nGraph the queue, on the payments dashboard\.\nDashboard: https:\/\/example\.com\/d/);
    assert.match(sent, new RegExp(`Action item ID: ${helped}`));
    assert.match(sent, /Help me do this\.$/);
    assert.deepEqual(shown, [{ tab: 'chat' }]);
    const memory = openCheck(h.root, 'quality').memory.text;
    assert.match(memory, /"Count failed retries": Done\./);
    assert.match(memory, /"Alert on refunds": Not doing it\./);
  } finally {
    await app.close();
  }
});

test('an answer about a routine that changes it goes to the main agent, and keeping it only closes the item', async t => {
  const h = fixture(t);
  const choices = [{ value: 'later', label: 'Not now' }, { value: 'off', label: 'Turn it off' }, { value: 'keep', label: 'Keep it as it is' }];
  const about = id => fileActionItem(h.root, { key: `care:${id}`, from: 'hobkin', title: `You opened 0 of the last 10 reports from ${id}`, choices, answerTo: { kind: 'routines', subject: 'routine', id, file: `/routines/daily/${id}.md` } }).id;
  const [news, disk] = ['news', 'disk'].map(about);
  const app = await h.openApp({ intervalMs: HOUR_MS });
  try {
    await app.workAction('decide', disk, 'keep');
    await app.workAction('decide', news, 'off');
    await app.outgoing;
    await app.runtime.idle();

    assert.deepEqual(openDecisions(h.root), []);
    const sent = app.runtime.messages().filter(message => message.role === 'user').map(message => message.content);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Routine file: \/routines\/daily\/news\.md/);
    assert.match(sent[0], /Turn this routine off\.$/);
  } finally {
    await app.close();
  }
});

test('an answer that cannot reach its item stays open, and a stale one is refused', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    const { id } = fileDecision(h.root, { from: 'Work mode', question: 'Delete it?', choices: yesNo, answerTo: { kind: 'work', slug: 'gone', item: 'abc' } });

    await assert.rejects(app.workAction('decide', id, 'yes'));
    assert.equal(openDecisions(h.root).length, 1);
    await assert.rejects(app.workAction('decide', id, 'maybe'), /not one of its choices/);
    await assert.rejects(app.workAction('decide', 'nothing', 'yes'), /already answered/);
  } finally {
    await app.close();
  }
});

/** A real repository with one finished branch, and a decision offering to land it. */
function offered(h, t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-offered-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const checkout = repository(base, 'api');
  branched(checkout, 'hobkin/fix', 'feature.txt', 'feature\n');
  chooseProject(h.root, checkout, 'important');
  const { id: item } = fileItem(h.root, 'api', { key: 'fix', kind: 'fix', title: 'Fix login', brief: 'The first change.' });
  updateItem(h.root, 'api', item, { state: 'branch', branch: 'hobkin/fix' });
  const head = git(checkout, 'rev-parse', 'hobkin/fix');
  const choices = ['later', 'merge', 'read', 'no'].map(value => ({ value, label: value }));
  const offer = answerTo => fileDecision(h.root, { key: `offer:api:${item}`, from: 'Work mode', question: 'Fix login can land.', choices, answerTo: { kind: 'merge', slug: 'api', item, head, ...answerTo } }).id;
  return { checkout, item, head, offer };
}

const onlyItem = h => readItems(h.root, 'api')[0];

test('saying merge lands it on the offer route and closes the decision', async t => {
  const h = fixture(t);
  const { checkout, offer } = offered(h, t);
  const app = await h.openApp();
  try {
    const { message } = await app.workAction('decide', offer(), 'merge');

    assert.match(message, /Merged "Fix login" into main/);
    assert.equal(onlyItem(h).landed.route, 'offer');
    assert.equal(git(checkout, 'rev-parse', 'main'), git(checkout, 'rev-parse', 'hobkin/fix'));
    assert.deepEqual(openDecisions(h.root), []);
  } finally {
    await app.close();
  }
});

test('a merge that fails leaves the decision open and throws the reason for the screen', async t => {
  const h = fixture(t);
  const { checkout, offer } = offered(h, t);
  const app = await h.openApp();
  try {
    const before = git(checkout, 'rev-parse', 'main');

    await assert.rejects(app.workAction('decide', offer({ head: 'an older commit' }), 'merge'), /moved since it was offered/);

    assert.equal(git(checkout, 'rev-parse', 'main'), before);
    assert.equal(openDecisions(h.root).length, 1);
  } finally {
    await app.close();
  }
});

test('an offer answered on screen that fails stays in Action Items, says why in Chat and is not asked again at once', async t => {
  const h = fixture(t);
  const { offer } = offered(h, t);
  let asked = 0;
  const app = await h.openApp({ askQuestion: async () => { asked += 1; return 'merge'; } });
  try {
    offer({ head: 'an older commit' });

    await app.presentDecision();
    await app.presentDecision();

    assert.equal(asked, 1);
    assert.equal(openDecisions(h.root).length, 1);
    const view = await app.refresh();
    assert.match(view.messages.find(({ role }) => role === 'notice').content, /moved since it was offered/);
  } finally {
    await app.close();
  }
});

test('read opens that row\'s page in Done and holds the offer, and later only holds it', async t => {
  const h = fixture(t);
  const { item, offer } = offered(h, t);
  const opened = [];
  const app = await h.openApp({ showDone: row => opened.push(row) });
  try {
    await app.workAction('decide', offer(), 'read');

    assert.deepEqual(opened.map(({ slug, item: id }) => [slug, id]), [['api', item]]);
    assert.ok(onlyItem(h).offerHeldUntil);
    assert.equal(onlyItem(h).state, 'branch');

    await app.workAction('decide', offer(), 'later');

    assert.equal(opened.length, 1);
    assert.deepEqual(openDecisions(h.root), []);
  } finally {
    await app.close();
  }
});

test('no declines the item, and an offer whose item left the list closes by itself on a tick', async t => {
  const h = fixture(t);
  const { offer } = offered(h, t);
  const app = await h.openApp();
  try {
    await app.workAction('decide', offer(), 'no');
    assert.equal(onlyItem(h).state, 'declined');

    offer();
    retireOffers(h.root);

    assert.deepEqual(openDecisions(h.root), []);
  } finally {
    await app.close();
  }
});

test('a decision that answers a read opens the row whatever else it says', async t => {
  const h = fixture(t);
  const { item } = offered(h, t);
  const opened = [];
  const app = await h.openApp({ showDone: row => opened.push(row) });
  try {
    const { id } = fileDecision(h.root, { from: 'Work mode', question: 'Read it?', choices: [{ value: 'later', label: 'Later' }, { value: 'read', label: 'Read it' }], answerTo: { kind: 'read', slug: 'api', item } });

    await app.workAction('decide', id, 'read');

    assert.deepEqual(opened.map(row => row.item), [item]);
  } finally {
    await app.close();
  }
});

test('a full chat compacts itself when nothing needs it, and leaves it alone when it is not full', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    let compactions = 0;
    app.runtime.main.compact = async () => { compactions += 1; };
    const usage = percent => { app.runtime.main.getContextUsage = () => ({ percent, tokens: 1, contextWindow: 100 }); };

    usage(70);
    await app.tickCompaction();
    assert.equal(compactions, 0);

    usage(85);
    await app.tickCompaction();
    assert.equal(compactions, 1);
  } finally {
    await app.close();
  }
});

/** hobkin compacts the chat at `percent` full and holds it there. Pi's abort ends a compaction with nothing changed. */
function compactingAt(app, percent) {
  const main = app.runtime.main;
  const compaction = Promise.withResolvers();
  const held = { compaction, aborts: 0 };
  main.getContextUsage = () => ({ percent, tokens: percent, contextWindow: 100 });
  main.compact = () => compaction.promise;
  main.abort = async () => {
    held.aborts += 1;
    compaction.reject(Error('Compaction cancelled'));
  };
  held.compacted = app.tickCompaction();
  return held;
}

/** 'went' once hobkin took the message within `ms`, or 'still waiting'. */
function goesWithin(sent, ms) {
  const went = sent.then(() => 'went');
  const waited = new Promise(resolve => setTimeout(resolve, ms, 'still waiting'));
  return Promise.race([went, waited]);
}

const userSaid = (app, words) => app.runtime.messages()
  .some(message => message.role === 'user' && JSON.stringify(message.content).includes(words));

test('a message from the user stops a compaction hobkin began early, and goes at once', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  const held = compactingAt(app, 85);

  const sent = app.send('go back to the default system theme');

  try {
    assert.equal(app.runtime.mainFree, false, 'the compaction holds the chat');

    assert.equal(await goesWithin(sent, 1000), 'went');

    assert.equal(held.aborts, 1);
    assert.equal(await held.compacted, false);
    assert.equal(userSaid(app, 'go back to the default system theme'), true);
  } finally {
    held.compaction.resolve();
    await sent.catch(() => {});
    await app.close();
  }
});

test('a chat too full to wait finishes compacting, and the message goes as soon as that ends', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  const held = compactingAt(app, 96);

  const sent = app.send('go back to the default system theme');

  try {
    assert.equal(await goesWithin(sent, 300), 'still waiting');
    assert.equal(held.aborts, 0);

    held.compaction.resolve();

    assert.equal(await goesWithin(sent, 1000), 'went');
    assert.equal(await held.compacted, true);
    assert.equal(userSaid(app, 'go back to the default system theme'), true);
  } finally {
    held.compaction.resolve();
    await sent.catch(() => {});
    await app.close();
  }
});

test('opening the dashboard moves an old home\'s folder and leaves its old path working', async t => {
  const h = fixture(t);
  renameSync(join(h.root, 'routines'), join(h.root, 'schedules'));

  const app = await h.openApp();

  try {
    assert.equal(lstatSync(join(h.root, 'routines')).isDirectory(), true);
    assert.equal(lstatSync(join(h.root, 'schedules')).isSymbolicLink(), true);
  } finally {
    await app.close();
  }
});

test('the note Chrome leaves when authorized stays out of Chat', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    await app.runtime.main.sendCustomMessage({ customType: 'pi-chrome-tool-change', content: 'Chrome tools enabled.', display: true }, { triggerTurn: false });
    await app.runtime.main.sendCustomMessage({ customType: 'other-extension', content: 'Worth showing.', display: true }, { triggerTurn: false });

    const view = await app.refresh();

    assert.deepEqual(view.messages.map(message => message.content), ['Worth showing.']);
  } finally {
    await app.close();
  }
});

test('a message an extension marks display false is for the agent, so it stays out of Chat', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    await app.runtime.main.sendCustomMessage({ customType: 'tasks-reminder', content: '<system-reminder>For the agent.</system-reminder>', display: false }, { triggerTurn: false });
    await app.runtime.main.sendCustomMessage({ customType: 'other-extension', content: 'Worth showing.', display: true }, { triggerTurn: false });

    const view = await app.refresh();

    assert.deepEqual(view.messages.map(message => message.content), ['Worth showing.']);
  } finally {
    await app.close();
  }
});

test('messages go out in the order they were typed, waiting while the conversation cannot take one', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  const sent = [];
  let refusals = 2;
  app.runtime.send = async text => {
    if (text === 'first' && refusals-- > 0) throw Error(MAIN_BUSY);
    sent.push(text);
    return { id: text };
  };
  try {
    await Promise.all([app.send('first'), app.send('second')]);

    assert.deepEqual(sent, ['first', 'second']);
  } finally {
    await app.close();
  }
});

test('a message that cannot go out fails on its own and the next one still goes', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  const sent = [];
  app.runtime.send = async text => {
    if (text === 'bad') throw Error('no route');
    sent.push(text);
    return { id: text };
  };
  try {
    await assert.rejects(app.send('bad'), /no route/);
    await app.send('next');

    assert.deepEqual(sent, ['next']);
  } finally {
    await app.close();
  }
});

test('a request for more tokens reaches Chat once', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  const day = new Date().toDateString();
  try {
    writeMode(h.root, { enabled: true, allowanceRequest: { day, limit: 100, proposed: 200, atLimit: true, at: new Date().toISOString(), reason: 'Work mode paused: 3 items are waiting.' } });

    await app.refresh();
    const view = await app.refresh();

    const notices = view.messages.filter(message => message.role === 'notice');
    assert.deepEqual(notices.map(({ content, tone }) => [content, tone]), [['Work mode paused: 3 items are waiting.', 'critical']]);
  } finally {
    await app.close();
  }
});

test('a pause for the hour reads as news, and running out for the day posts again', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  const request = { day: new Date().toDateString(), limit: 100, proposed: 200 };
  try {
    writeMode(h.root, { enabled: true, allowanceRequest: { ...request, atLimit: false, at: new Date(1000).toISOString(), reason: 'Paused for the hour.' } });
    await app.refresh();
    writeMode(h.root, { allowanceRequest: { ...request, atLimit: true, at: new Date(2000).toISOString(), reason: 'Paused for the day.' } });

    const view = await app.refresh();

    const notices = view.messages.filter(message => message.role === 'notice');
    assert.deepEqual(notices.map(({ content, tone }) => [content, tone]), [['Paused for the hour.', 'useful'], ['Paused for the day.', 'critical']]);
  } finally {
    await app.close();
  }
});

test('the Work tab sets a project\'s priority and PR mode and an item\'s grade, and done clears what was left', async t => {
  const h = fixture(t);
  chooseProject(h.root, '/repos/api', 'casual');
  const { id } = fileItem(h.root, 'api', { key: 'fix', kind: 'fix', title: 'Fix login', brief: 'The first change.' });
  updateItem(h.root, 'api', id, { left: 'Rotate the token.' });
  const app = await h.openApp();
  try {
    await app.workAction('priority', 'api', 'P1');
    await app.workAction('prs', 'api', 'draft');
    await app.workAction('grade', 'api', id, 'P0');

    const { priority, prMode } = readProject(h.root, 'api');
    assert.deepEqual([priority, prMode], ['P1', 'draft']);
    assert.equal(readItems(h.root, 'api')[0].grade, 'P0');

    await app.workAction('done', 'api', id);

    const [done] = readItems(h.root, 'api');
    assert.deepEqual([done.state, done.left], ['done', null]);
  } finally {
    await app.close();
  }
});

const usefulReport = () => backgroundRun('useful', {
  title: 'Health progress',
  result: { status: 'completed', text: 'Useful: Resting heart rate fell 3 bpm over two weeks.\n\nDetails.' },
});

test('a useful scheduled report makes hobkin happy through a real refresh', async t => {
  const h = fixture(t);
  const runHarness = async () => { throw Error('Unexpected provider call in synthetic mood test.'); };
  const app = await h.openApp({ runHarness });
  try {
    await app.runtime.change(state => { state.runs.useful = usefulReport(); });

    const view = await app.refresh();

    assert.equal(view.mood.mood, 'happy');
  } finally {
    await app.close();
  }
});

test('what the user types reaches the face while the turn runs, and the words stay out of what is kept', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    const control = h.fake.controls.get(app.runtime.main.sessionId);
    Object.assign(control, { gate: Promise.withResolvers(), started: Promise.withResolvers() });

    const accepted = app.send('dont be happy, you are doing terrible');
    await control.started.promise;
    await app.refreshing;
    const view = await app.refresh();

    assert.equal(view.mood.mood, 'sad');
    assert.equal(view.mood.cause, 'user said the work is bad');
    control.gate.resolve();
    await accepted;
    await app.runtime.idle();
  } finally {
    await app.close();
  }
  const kept = readdirSync(join(h.root, 'runtime/events')).map(name => readFileSync(join(h.root, 'runtime/events', name), 'utf8')).join('');
  assert.doesNotMatch(kept, /doing terrible/);
});

test('a routine stalling twice running turns the face grumpy through a real refresh', async t => {
  const h = fixture(t);
  const app = await h.openApp({ runHarness: async () => { throw Error('Unexpected provider call in synthetic mood test.'); } });
  const blocked = { status: 'completed', text: 'Blocked: The login needs a code.' };
  try {
    await app.runtime.change(state => {
      state.runs.first = backgroundRun('first', { scheduleId: 'digest', result: blocked });
      state.runs.second = backgroundRun('second', { scheduleId: 'digest', status: 'running', startedAt: '2026-01-03T08:00:00.000Z', finishedAt: '2026-01-03T08:01:00.000Z', result: blocked });
    });
    await app.refresh();

    await app.runtime.change(state => { state.runs.second.status = 'completed'; });
    const view = await app.refresh();

    assert.equal(view.mood.mood, 'grumpy');
  } finally {
    await app.close();
  }
});

test('an item merged by anything reaches the face', async t => {
  const h = fixture(t);
  chooseProject(h.root, '/repos/api', 'casual');
  const { id } = fileItem(h.root, 'api', { key: 'one', kind: 'fix', title: 'One', brief: 'Evidence.' });
  const app = await h.openApp();
  try {
    updateItem(h.root, 'api', id, { state: 'merged' });

    const view = await app.refresh();

    assert.equal(view.mood.mood, 'celebrating');
  } finally {
    await app.close();
  }
});

test('a setting left in config.json by a removed feature loads and does nothing', async t => {
  const h = fixture(t);
  // The user's real config still holds this key, and the name is put together so a search for it finds only history.
  const removed = ['j', 'ev'].join('');
  atomicJson(join(h.root, 'config.json'), { ...h.config, [removed]: { enabled: true } });
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Nothing here reaches the network.'); });

  assert.deepEqual(loadConfig(h.root)[removed], { enabled: true });
  const app = await h.openApp();
  try {
    await app.send('Thank you.');
    await app.runtime.idle();
    assert.deepEqual(setLearning(h.root, true), { enabled: true });
    assert.equal((await app.refresh()).learning, true);
  } finally {
    await app.close();
  }
});

const refused = {
  role: 'assistant',
  content: [],
  stopReason: 'error',
  errorMessage: '401: {"message":"Authentication Fails, Your api key: ****0000 is invalid","type":"authentication_error"}',
  timestamp: 2,
};

test('a turn the model refused says why in Chat, and how to sign in again', async t => {
  const h = fixture(t);
  const app = await h.openApp({ intervalMs: 60000 });
  t.after(() => app.close());
  app.runtime.messages = () => [{ role: 'user', content: 'Hello', timestamp: 1 }, refused];

  const { content } = (await app.refresh()).messages.at(-1);

  assert.match(content, /Authentication Fails, Your api key: \*\*\*\*0000 is invalid/);
  assert.match(content, /hobkin login/);
  assert.doesNotMatch(content, /authentication_error/);
});

test('a failure that is not about signing in does not send anyone to sign in', async t => {
  const h = fixture(t);
  const app = await h.openApp({ intervalMs: 60000 });
  t.after(() => app.close());
  app.runtime.messages = () => [{ ...refused, errorMessage: 'Connection reset by peer' }];

  const { content } = (await app.refresh()).messages.at(-1);

  assert.match(content, /Connection reset by peer/);
  assert.doesNotMatch(content, /hobkin login/);
});

test('a failure Pi retried past stays out of Chat', async t => {
  const h = fixture(t);
  const app = await h.openApp({ intervalMs: 60000 });
  t.after(() => app.close());
  const answer = { role: 'assistant', content: [{ type: 'text', text: 'Hello.' }], stopReason: 'stop', timestamp: 3 };
  app.runtime.messages = () => [refused, answer];

  const contents = (await app.refresh()).messages.map(message => message.content);

  assert.equal(contents.some(content => content.includes('Authentication Fails')), false);
  assert.ok(contents.includes('Hello.'));
});

const clipboardWith = bytes => ({ getFilePaths: async () => null, getImage: async () => bytes, getText: async () => null });

test('a pasted image reaches the model as an image, and the saved chat keeps only a marker', async t => {
  const h = fixture(t);
  const bytes = png(10, 10);
  const app = await h.openApp({ clipboard: clipboardWith(bytes) });
  t.after(() => app.close());

  const { image } = await app.pasteImage();
  await app.send('What is this?', null, [image]);
  await app.runtime.mainWork;
  await app.refresh();

  const sent = app.runtime.messages().find(message => message.role === 'user');
  assert.deepEqual(sent.content.at(-1), { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' });
  assert.equal(existsSync(image.file), false, 'nothing needs the file once it has gone');
  const view = readFileSync(join(h.root, 'runtime/view.json'), 'utf8');
  assert.equal(view.includes(bytes.toString('base64')), false);
  const chat = JSON.parse(view).messages.find(message => message.role === 'user');
  assert.equal(chat.content, 'What is this?');
  assert.equal(chat.images, 1);
});

test('an image stays on disk when its message fails, so it can go again', async t => {
  const h = fixture(t);
  const app = await h.openApp({ clipboard: clipboardWith(png(10, 10)) });
  t.after(() => app.close());
  const { image } = await app.pasteImage();
  app.runtime.send = async () => { throw Error('no route'); };

  await assert.rejects(app.send('look', null, [image]), /no route/);

  assert.equal(existsSync(image.file), true);
});

test('a model that cannot see images refuses them at the paste and at the send', async t => {
  const h = fixture(t);
  const app = await h.openApp({ clipboard: clipboardWith(png(10, 10)) });
  t.after(() => app.close());
  const { image } = await app.pasteImage();
  app.runtime.main.model = { provider: 'fixture', id: 'text', input: ['text'] };

  assert.deepEqual(await app.pasteImage(), { notice: 'fixture/text cannot see images.', tone: 'warning' });
  await assert.rejects(app.send('look', null, [image]), /fixture\/text cannot see images/);
  assert.equal(existsSync(image.file), true);
});

test('a chat close to its size limit refuses images and says how to go on, and still takes words', async t => {
  const h = fixture(t);
  const app = await h.openApp({ clipboard: clipboardWith(png(10, 10)) });
  t.after(() => app.close());
  const full = { notice: 'This chat is full of images. /reset starts a fresh one.', tone: 'warning' };
  const { image } = await app.pasteImage();
  const { sessionFile } = app.runtime.main;

  truncateSync(sessionFile, MAX_SESSION_BYTES - IMAGE_ROOM_BYTES - 1);
  assert.ok((await app.pasteImage()).image, 'one byte short of the line, images still go');

  truncateSync(sessionFile, MAX_SESSION_BYTES - IMAGE_ROOM_BYTES);
  assert.deepEqual(await app.pasteImage(), full);
  await assert.rejects(app.send('look', null, [image]), /full of images/);
  assert.equal(existsSync(image.file), true, 'what was attached already waits for a chat that can take it');

  await app.send('just words');
  await app.runtime.mainWork;
  assert.equal(app.runtime.messages().at(-1).content[0].text, 'Reply: just words');

  await app.reset();
  assert.ok((await app.pasteImage()).image, '/reset does what the message says');
});

test('images nothing is waiting for go when hobkin opens and when it closes', async t => {
  const h = fixture(t);
  mkdirSync(join(h.root, 'runtime/pasted'), { recursive: true });
  writeFileSync(join(h.root, 'runtime/pasted/left-behind.png'), 'x');

  const app = await h.openApp({ clipboard: clipboardWith(png(10, 10)) });
  assert.equal(existsSync(join(h.root, 'runtime/pasted/left-behind.png')), false);

  const { image } = await app.pasteImage();
  await app.close();
  assert.equal(existsSync(image.file), false);
});

test('a message counts its turn from when the user sent it, when told when that was', async t => {
  const h = fixture(t);
  const app = await h.openApp({ intervalMs: 60000 });
  t.after(() => app.close());
  const sentAt = Date.now() - 250;
  const { id } = await app.send('Hello', undefined, [], { sentAt });
  await app.runtime.idle();
  const timed = (await app.runtime.state()).runs[id].performance;
  assert.deepEqual([timed.origin, timed.kind, timed.engine, timed.model], ['window', 'main', 'pi', 'fixture/local']);
  assert.ok(timed.stages.host >= 250 && timed.stages.handed >= timed.stages.host && timed.stages.admitted >= timed.stages.handed);
  // Words nobody timed count from when they reached hobkin.
  const plain = await app.send('Again');
  await app.runtime.idle();
  const untimed = (await app.runtime.state()).runs[plain.id].performance;
  assert.equal(untimed.origin, 'host');
  assert.equal(Object.hasOwn(untimed.stages, 'host'), false);
});

test("a run's teams agents travel in teamsAgents, never in jobChildren", async t => {
  const root = mkdtempSync(join(tmpdir(), 'teams-publication-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root });
  const runtime = new HobkinRuntime(root, config, { ownedLifecycle: { snapshot: () => [] } });
  const { TeamsAgents } = await import('../src/cli/teams-agents.mjs');
  const app = new HobkinApplication();
  app.runtime = runtime; app.snapshot = {}; app.now = () => 1000;
  // No real ~/.pi: the reader gets a folder of its own and no timers.
  app.teamsAgents = new TeamsAgents({ teamsDir: join(root, 'teams'), now: app.now, schedule: () => () => {} });
  const spawn = [
    { type: 'tool_execution_start', toolCallId: 'c', toolName: 'spawn_agent', args: { name: 'scout', prompt: 'Find it', model_slot: 'read-review' } },
    { type: 'tool_execution_end', toolCallId: 'c', toolName: 'spawn_agent', isError: false, result: { content: [{ type: 'text', text: 'Started.' }], details: { name: 'scout', session: 'session-abc', queued: false } } },
  ];
  const copies = structuredClone(spawn);
  for (const event of spawn) app.observeActivity('job', event);
  app.publishActivity();
  assert.deepEqual(app.snapshot.teamsAgents.job.map(({ name, state, task }) => [name, state, task]), [['scout', 'running', 'Find it']]);
  assert.deepEqual(app.snapshot.jobChildren, {});
  assert.deepEqual(spawn, copies, "the run's events reach the reader unchanged");
  assert.equal(app.snapshot.jobActivity.job[0].name, 'spawn_agent', "the run's own feed still has the call as a step");
});
