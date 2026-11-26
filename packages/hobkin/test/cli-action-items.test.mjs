import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buildContext } from '../src/cli/context.mjs';
import { ACTION_CHOICES, answerDecision, handDecision, openDecisions, runActionCommand, runDecideCommand } from '../src/cli/decisions.mjs';
import { pendingCard } from '../src/cli/pending.mjs';
import { readPending } from '../src/cli/pending-read.mjs';
import { Telemetry } from '../src/cli/telemetry.mjs';
import { runLearningCommand } from '../src/cli/learning/commands.mjs';
import { Learner } from '../src/cli/learning/learner.mjs';
import { learningState, readActions, saveState } from '../src/cli/learning/store.mjs';
import { attentionView, itemCounts } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, proposeProject, updateItem } from '../src/cli/work/store.mjs';
import { fileTemplateNews, lookAfterRoutines } from '../src/cli/routine-care.mjs';

const DAY_MS = 86400000;
const NOW = Date.parse('2026-11-10T12:00:00Z');

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-action-items-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('explicit scope coverage hides only that learning proposal and survives regeneration without erasing lessons', t => {
  const root = home(t);
  const learner = new Learner({ root, telemetry: {}, now: () => NOW });
  const subjects = ['work.discover', 'repo-spec-rollout', 'other'].map(scope => ({ scope, title: scope, conclusion: 'rethink', code: 'blocked', seen: 5, runs: 6, days: 3, latest: new Date(NOW).toISOString() }));
  const saved = { proposals: [], lessons: subjects, pullRequests: {} };
  const proposals = learner.proposalsFrom(subjects, saved, readActions(root));
  saveState(root, { ...saved, proposals });
  const discovery = proposals.find(p => p.scope === 'work.discover');
  const rollout = proposals.find(p => p.scope === 'repo-spec-rollout');
  learner.post = { proposal: discovery.id, id: 'notice', content: 'stale queued proposal' };
  assert.throws(() => runLearningCommand(root, ['cover', discovery.id, ' ']), /evidence/);
  runLearningCommand(root, ['cover', discovery.id, 'User finished discovery and selected exactly five projects.'], { now: NOW });
  runLearningCommand(root, ['cover', rollout.id, 'Finite approved rollout already owns this scope.'], { now: NOW });
  assert.deepEqual(learningState(root).proposals.map(p => p.scope), ['other']);
  assert.equal(learningState(root).lessons.length, 3);
  assert.deepEqual(learner.proposalsFrom(subjects, saved, readActions(root)).map(p => p.scope), ['other']);
  assert.equal(learner.takePost(), null, 'a stale prepared chat notice cannot republish covered work');
  const changed = [{ ...subjects[0], definition: 'new-user-approved-definition' }];
  assert.equal(learner.proposalsFrom(changed, saved, readActions(root)).length, 1, 'materially changed scope is not covered by an old receipt');
});

test('done delivery disclaimers are history, while approvals, personal requirements and unknown work remain', t => {
  const root = home(t);
  proposeProject(root, { name: 'App', path: root, level: 'casual', summary: 'App' });
  chooseProject(root, 'app');
  const add = (key, left, extra = {}) => {
    const item = fileItem(root, 'app', { key, kind: 'fix', title: key, brief: 'Fix with proof', impact: 'high', effort: 'small' });
    updateItem(root, 'app', item.id, { state: 'done', left, ...extra });
    return item;
  };
  const delivery = add('done', 'Nothing pushed, opened, merged, deployed or released; landing is off and the branch has no remote and no PR. No code review was run because reviewAsked was absent.');
  add('approval', 'Publication and deployment of the approved revision remain outside this local-only run; landing is off, so nothing was pushed or deployed.');
  add('unknown', 'The test still fails.');
  add('personal', 'Provide access', { leftKind: 'personal' });
  const rows = attentionView(root).filter(row => row.kind === 'item');
  assert.deepEqual(rows.map(row => [row.title, row.attentionKind]), [['approval', 'approval'], ['unknown', 'work'], ['personal', 'personal']]);
  assert.equal(itemCounts([{ ...delivery, state: 'done', left: 'Nothing pushed.' }]).left, 0);
  assert.equal(itemCounts([{ ...delivery, state: 'stuck', left: 'Nothing pushed.' }]).left, 1, 'failed work is not completed by a disclaimer');
  add('mixed', 'Nothing pushed. Fix the failing test.');
  assert.ok(attentionView(root).some(row => row.title === 'mixed'));
});

const act = (root, item, args = ['routine', 'quality'], now = NOW) => runActionCommand(root, args, Readable.from([JSON.stringify(item)]), now);
const retries = {
  key: 'retry-counter',
  title: 'Count the retries that fail',
  detail: 'The retry change shipped Tuesday, and nothing counts the retries that fail, so a spike would go unseen.',
  why: 'You own the payments service.',
  links: [{ label: 'Payments dashboard', url: 'https://example.com/d/payments' }],
};

test('a routine files an action item that waits in Action Items with its links, and the same key updates it instead of adding one', async t => {
  const root = home(t);

  const filed = await act(root, retries);
  const again = await act(root, { ...retries, detail: 'Still nothing counts them.' }, undefined, NOW + 1000);

  assert.equal(again.id, filed.id);
  const [item] = openDecisions(root);
  assert.deepEqual(
    [item.tldr, item.question, item.why, item.from, item.shown, item.answerTo, item.links],
    ['Count the retries that fail', 'Still nothing counts them.', 'You own the payments service.', 'Routine quality', true, { kind: 'action', id: 'quality' }, retries.links],
  );
  assert.deepEqual(item.choices, ACTION_CHOICES);
  assert.equal(openDecisions(root).length, 1);
});

test('only the real action counts; report reads and later checks do not complete or reopen it', async t => {
  const root = home(t);
  const report = { id: 'mail:run', scheduleId: 'quality', title: 'Mail', at: new Date(NOW).toISOString(), outcome: 'completed', body: 'Useful: Signed.\nNext: Save and check the document.' };
  const unrelated = { ...report, id: 'other:run', scheduleId: 'other' };
  const filed = await act(root, { ...retries, reports: [report.id] });
  assert.equal(readPending(root, { reports: [report, unrelated], now: NOW }).total, 1);
  assert.equal(openDecisions(root)[0].id, filed.id);
  Telemetry.open(root, NOW).recordReportRead({ id: report.id, dwellMs: 3000 }, NOW);
  assert.equal(openDecisions(root).length, 1, 'reading is not completion');
  assert.equal(readPending(root, { reports: [report, unrelated], now: NOW }).total, 1);
  await act(root, { key: retries.key, done: 'User confirmed done.' });
  assert.equal(readPending(root, { reports: [report, unrelated], now: NOW }).total, 0);
  assert.deepEqual(openDecisions(root), []);
  assert.equal((await act(root, retries)).answer, 'done');
  assert.equal(readPending(root, { reports: [report, unrelated], now: NOW + 1000 }).total, 0);
  const quiet = { ...report, id: 'quiet:run', at: new Date(NOW + 1000).toISOString(), body: 'Nothing new.' };
  assert.equal(readPending(root, { reports: [report, quiet, unrelated], now: NOW + 1000 }).total, 0);
});

test('a historical report can be linked with evidence without reopening or replacing a done answer', async t => {
  const root = home(t);
  const filed = await act(root, retries);
  answerDecision(root, filed.id, 'done', NOW);
  await act(root, { reports: ['old:report'], evidence: 'Reviewed report asks for this exact action.' }, ['link', filed.id]);
  assert.deepEqual(openDecisions(root), []);
  const reports = [{ id: 'old:report', title: 'Old', at: new Date(NOW).toISOString(), outcome: 'completed', body: 'Useful: Done.\nNext: Do it.' }];
  assert.equal(readPending(root, { reports, now: NOW }).total, 0);
  await assert.rejects(act(root, { reports: ['old:report'], evidence: ' ' }, ['link', filed.id]), /evidence/);
  await assert.rejects(act(root, { ...retries, reports: [''] }), /report/);
});

test('the routine closes its own item with what shows it is done, and closing one that is not open changes nothing', async t => {
  const root = home(t);
  await act(root, retries);

  const closed = await act(root, { key: 'retry-counter', done: 'The payments dashboard has a failed-retries panel since Nov 11.' });
  const nothing = await act(root, { key: 'never-filed', done: 'It is there.' });

  assert.equal(closed.ok, true);
  assert.deepEqual(openDecisions(root), []);
  assert.match(nothing.message, /Nothing is open under that key/);
  await assert.rejects(act(root, { key: 'retry-counter', done: ' ' }), /says what shows it is done/);
});

test('shared case steps deduplicate across routines, preserve done evidence and reopen only on material change', async t => {
  const root = home(t);
  const step = { ...retries, caseKey: 'letter:envelope-123:signature', reports: ['mail:1'] };
  const first = await act(root, step);
  const same = await act(root, { ...step, reports: ['legal:1'] }, ['routine', 'legal']);
  assert.equal(same.id, first.id);
  await act(root, { caseKey: step.caseKey, done: 'Provider completion notice confirms all signatures, not document contents.' }, ['routine', 'legal']);
  assert.equal((await act(root, step, undefined, NOW + 60 * DAY_MS)).answer, 'done');
  assert.deepEqual(openDecisions(root), []);
  await act(root, { ...retries, caseKey: 'letter:envelope-123:contents' });
  assert.equal(openDecisions(root).length, 1, 'signature evidence never settles content verification');
  const reopened = await act(root, { ...step, changed: 'Provider voided the exact envelope.' });
  assert.notEqual(reopened.id, first.id);
  assert.equal(openDecisions(root).length, 2);
  for (const caseKey of ['', {}, 'bad\nidentity']) {
    await assert.rejects(act(root, { ...retries, caseKey }), /caseKey/);
  }
});

test('not doing it and done hold unless material evidence permits reopening done', async t => {
  const root = home(t);
  const dropped = await act(root, retries);
  answerDecision(root, dropped.id, 'drop', NOW);

  const refused = await act(root, { ...retries, changed: 'It broke again.' }, undefined, NOW + 90 * DAY_MS);
  assert.equal(refused.answer, 'drop');
  assert.match(refused.message, /not doing this/);

  const other = { ...retries, key: 'alert' };
  const done = await act(root, other);
  answerDecision(root, done.id, 'done', NOW);
  assert.equal((await act(root, other, undefined, NOW + 60 * DAY_MS)).answer, 'done');
  assert.ok((await act(root, { ...other, changed: 'The alert fired nowhere on Nov 12.' }, undefined, NOW + DAY_MS)).id);
  assert.equal(openDecisions(root).length, 1);
});

test('an item needs a title, text and links that are plain web addresses, and only a routine files one', async t => {
  const root = home(t);
  const linked = url => act(root, { ...retries, links: [{ label: 'Page', url }] });

  await assert.rejects(act(root, { key: 'x', title: ' ' }), /needs a title/);
  await assert.rejects(act(root, { ...retries, detail: 5 }), /are text/);
  await assert.rejects(linked('javascript:alert(1)'), /web addresses/);
  await assert.rejects(linked(['https://example.com/a']), /web addresses/);
  await assert.rejects(linked('https://example.com/\u001b]8;;https://elsewhere.example\u0007x'), /web addresses/);
  await assert.rejects(act(root, { ...retries, links: Array.from({ length: 7 }, () => retries.links[0]) }), /up to 6/);
  await assert.rejects(act(root, retries, ['work', 'api', 'item']), /routine <id>/);
  await assert.rejects(runActionCommand(root, ['done', 'some-id'], Readable.from([''])), /one JSON object/);
  assert.deepEqual(openDecisions(root), []);

  await act(root, { ...retries, links: [{ label: 'Bell\u0007 page', url: 'HTTPS://Example.com/a b' }] });
  assert.deepEqual(openDecisions(root)[0].links, [{ label: 'Bell  page', url: 'https://example.com/a%20b' }]);
});

test('a question filed with hobkin decide carries no links and still gets its moment on screen', async t => {
  const root = home(t);
  const asked = { question: 'Keep the table?', choices: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }], links: [{ url: 'javascript:1' }], shown: true };

  await runDecideCommand(root, ['routine', 'mail'], Readable.from([JSON.stringify(asked)]), NOW);

  const [question] = openDecisions(root);
  assert.equal(question.links, undefined);
  assert.equal(question.shown, false);
});

test('the main agent closes an item it was handed by its ID, and an unknown ID changes nothing', async t => {
  const root = home(t);
  const { id } = await act(root, retries);
  handDecision(root, id, NOW);

  assert.ok(openDecisions(root)[0].handedAt, 'handing it keeps it open');
  assert.match((await act(root, { done: 'Nobody knows.' }, ['done', 'missing'])).message, /nothing changed/);
  assert.equal((await act(root, { done: 'The panel is live on the dashboard.' }, ['done', id])).id, id);
  assert.deepEqual(openDecisions(root), []);
});

test('a routine is told how to file an action item, and work runs are not', async t => {
  const root = home(t);
  const schedule = { id: 'quality', title: 'Quality', prompt: 'Check merged code.', cwd: root, harness: 'pi', model: null, context: [] };
  const check = { memory: null, log: [], decide: 'hobkin decide routine quality', action: 'hobkin action routine quality' };

  assert.match(await buildContext(schedule, null, [], check), /hobkin action routine quality/);
  assert.doesNotMatch(await buildContext(schedule, null, [], check, { lane: 'do' }), /hobkin action routine quality/);
});

test('the card counts action items as their own row, apart from questions', () => {
  const question = { id: 'q', tldr: 'Keep the table?', at: new Date(NOW).toISOString(), answerTo: { kind: 'routine', id: 'mail' } };
  const item = { id: 'a', tldr: 'Count the retries that fail', at: new Date(NOW).toISOString(), answerTo: { kind: 'action', id: 'quality' } };
  const template = { id: 's', tldr: 'Try the Meeting prep template', at: new Date(NOW).toISOString(), answerTo: { kind: 'routines', subject: 'template', id: 'meeting-prep' } };

  const { groups, total } = pendingCard({ decisions: [question, item, template], now: NOW });

  assert.equal(total, 3);
  assert.deepEqual(groups.map(({ name, count }) => [name, count]), [['questions', 1], ['todo', 2]]);
  assert.equal(groups[1].fact, 'Count the retries that fail');
});

const routine = (id, details = {}) => ({ id, title: id === 'disk' ? 'Disk space' : 'News digest', cadence: 'daily', enabled: true, at: '07:00', timezone: 'UTC', harness: 'pi', effort: 'low', model: null, cwd: '/tmp', context: [], prompt: 'Look.', path: `/home/routines/daily/${id}.md`, ...details });
const seen = (scheduleId, details = {}) => ({ scheduleId, title: scheduleId, reports: 10, read: 1, critical: 0, nothingNew: 2, usd: 1.2, lastReadAt: null, ignored: true, ...details });
const routineItems = root => openDecisions(root).filter(({ answerTo }) => answerTo?.kind === 'routines');

test('hobkin files one item for a routine nobody reads and one for a routine that finds nothing new, and leaves the rest alone', t => {
  const root = home(t);
  const schedules = [routine('news'), routine('disk'), routine('kept'), routine('off', { enabled: false }), routine('once', { cadence: 'once' })];
  const attention = [seen('news'), seen('disk', { nothingNew: 9, read: 0 }), seen('kept', { ignored: false }), seen('off'), seen('once')];

  const { filed } = lookAfterRoutines(root, { schedules, attention, now: NOW });

  assert.equal(filed.length, 2);
  const [news, disk] = routineItems(root);
  assert.equal(news.tldr, 'You opened 1 of the last 10 reports from News digest');
  assert.match(news.question, /^Each run costs about \$0\.12\. Turning it off saves its runs/);
  assert.deepEqual(news.choices.map(({ value }) => value), ['later', 'off', 'rework', 'keep']);
  assert.equal(disk.tldr, 'Nothing new in 9 of the last 10 runs of Disk space');
  assert.deepEqual(disk.choices.map(({ value }) => value), ['later', 'less', 'off', 'keep']);
  assert.deepEqual([news.from, news.answerTo.file], ['hobkin', '/home/routines/daily/news.md']);

  assert.deepEqual(lookAfterRoutines(root, { schedules, attention, now: NOW + 1000 }).filed, [], 'the same numbers file nothing again');
});

test('an item about a routine closes itself once its reports are wanted again or it is turned off', t => {
  const root = home(t);
  const schedules = [routine('news'), routine('disk', { title: 'Disk space' })];
  lookAfterRoutines(root, { schedules, attention: [seen('news'), seen('disk')], now: NOW });

  const { settled } = lookAfterRoutines(root, {
    schedules: [routine('news'), routine('disk', { enabled: false })],
    attention: [seen('news', { ignored: false }), seen('disk')],
    now: NOW + 1000,
  });

  assert.equal(settled.length, 2);
  assert.deepEqual(routineItems(root), []);
});

test('a routine file that did not load keeps its item, since it may only be unreadable', t => {
  const root = home(t);
  lookAfterRoutines(root, { schedules: [routine('news')], attention: [seen('news')], now: NOW });

  assert.deepEqual(lookAfterRoutines(root, { schedules: [], attention: [seen('news')], partial: true, now: NOW + 1000 }).settled, []);
  assert.equal(routineItems(root).length, 1);
  assert.equal(lookAfterRoutines(root, { schedules: [], attention: [], now: NOW + 2000 }).settled.length, 1, 'once every file loads, a missing routine is gone');
});

test('keeping a routine as it is holds until it is edited, and not now comes back after a week', t => {
  const root = home(t);
  const schedules = [routine('news')];
  const attention = [seen('news')];
  lookAfterRoutines(root, { schedules, attention, now: NOW });
  answerDecision(root, routineItems(root)[0].id, 'keep', NOW);

  assert.deepEqual(lookAfterRoutines(root, { schedules, attention, now: NOW + 30 * DAY_MS }).filed, []);
  assert.equal(lookAfterRoutines(root, { schedules: [routine('news', { prompt: 'Look harder.' })], attention, now: NOW + 30 * DAY_MS }).filed.length, 1, 'an edit asks again');

  answerDecision(root, routineItems(root)[0].id, 'later', NOW + 30 * DAY_MS);
  const edited = [routine('news', { prompt: 'Look harder.' })];
  assert.deepEqual(lookAfterRoutines(root, { schedules: edited, attention, now: NOW + 32 * DAY_MS }).filed, []);
  assert.equal(lookAfterRoutines(root, { schedules: edited, attention, now: NOW + 38 * DAY_MS }).filed.length, 1);
});

test('each new or newer template becomes one item to try, and an answer holds for that version', t => {
  const root = home(t);
  const prep = { id: 'meeting-prep', title: 'Meeting prep', version: 1, summary: 'A short brief before each meeting.', fits: 'Someone who walks into meetings cold.', file: '/hobkin/routine-templates/meeting-prep.md' };
  const brief = { ...prep, id: 'morning-brief', title: 'Morning brief', version: 2 };

  assert.equal(fileTemplateNews(root, { added: [prep], updated: [brief] }, NOW).length, 2);
  assert.deepEqual(fileTemplateNews(root, { added: [prep], updated: [brief] }, NOW), [], 'filed once');

  const [tryIt, newer] = routineItems(root);
  assert.equal(tryIt.tldr, 'Try the Meeting prep template');
  assert.equal(tryIt.question, 'A short brief before each meeting. It fits someone who walks into meetings cold.');
  assert.deepEqual(tryIt.choices.map(({ value }) => value), ['try', 'no']);
  assert.equal(newer.tldr, 'The Morning brief template has a newer version');
  assert.deepEqual(newer.answerTo, { kind: 'routines', subject: 'template', id: 'morning-brief', file: prep.file });

  answerDecision(root, tryIt.id, 'no', NOW);
  assert.deepEqual(fileTemplateNews(root, { added: [prep] }, NOW + 60 * DAY_MS), []);
  assert.equal(fileTemplateNews(root, { updated: [{ ...prep, version: 2 }] }, NOW + 60 * DAY_MS).length, 1, 'a newer version asks again');
});
