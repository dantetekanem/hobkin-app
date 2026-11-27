import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { initialize } from '../src/cli/config.mjs';
import { main } from '../src/cli/main.mjs';
import { GOAL_STARTERS, goalCards, listTemplates, readTemplate, TEMPLATE_GIVES, TEMPLATE_GOALS, templateNews, templateNotice } from '../src/cli/routine-templates.mjs';

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-templates-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  return root;
}

const template = (header, body = 'Read <their garden notes> and say what needs doing this week.') => {
  const lines = Object.entries(header).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
};
const garden = { title: 'Garden', summary: 'What the garden needs this week.', recurrence: 'Saturday mornings', group: 'life', fits: 'Someone who grows their own vegetables.' };

function yours(root, name, text) {
  const folder = join(root, 'routines', 'templates');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), text);
}

const byIdOf = templates => Object.fromEntries(templates.map(entry => [entry.id, entry]));

test('every shipped template names its goals, its bar, what it gives and what closes an item, and every starter names its goal', t => {
  const { templates, errors, rules } = listTemplates(home(t));

  assert.deepEqual(errors, []);
  assert.ok(templates.length >= 36);
  for (const { id, title, summary, recurrence, fits, goals, tells, gives, closes, source } of templates) {
    assert.ok(title && summary && recurrence && fits && tells && closes, id);
    assert.ok(goals.length && goals.every(goal => TEMPLATE_GOALS.includes(goal)), id);
    assert.ok(gives.length && gives.every(given => TEMPLATE_GIVES.includes(given)), id);
    assert.equal(source, 'hobkin', id);
  }
  assert.match(rules, /Nothing new\./);
  assert.deepEqual(TEMPLATE_GOALS, ['job', 'business', 'project', 'life', 'code'], 'the client holds the same list');
  assert.deepEqual(Object.keys(GOAL_STARTERS), TEMPLATE_GOALS);
  const byId = byIdOf(templates);
  for (const [goal, starters] of Object.entries(GOAL_STARTERS)) {
    assert.equal(starters.length, 3, goal);
    for (const id of starters) assert.ok(byId[id]?.goals.includes(goal), `${goal} starts with ${id}`);
  }
});

test('the job, business and project templates are there and read', t => {
  const byId = byIdOf(listTemplates(home(t)).templates);
  const shipped = {
    'job-openings': ['job', ['report'], false],
    'job-applications': ['job', ['report', 'action'], true],
    interviews: ['job', ['report', 'critical'], true],
    'business-leads': ['business', ['report', 'action'], true],
    runway: ['business', ['report', 'critical'], true],
    competitors: ['business', ['report'], false],
    'project-milestones': ['project', ['report', 'action'], false],
    'project-blockers': ['project', ['report', 'action', 'follow-up'], true],
  };

  for (const [id, [goal, gives, reads]] of Object.entries(shipped)) {
    assert.equal(byId[id]?.source, 'hobkin', id);
    assert.deepEqual([byId[id].goals[0], byId[id].gives, byId[id].private], [goal, gives, reads], id);
  }
});

test('each goal offers its starters, a template shows once under the first picked goal it starts, and the rest are more', t => {
  const root = home(t);
  yours(root, 'money.md', template({ ...garden, title: 'My money', goals: 'life' }));
  yours(root, 'garden.md', template(garden));
  const byId = byIdOf(listTemplates(root).templates);

  const cards = goalCards(root, ['life', 'project', 'nonsense', 'life']);

  assert.deepEqual(cards.map(({ goal }) => goal), ['project', 'life'], 'in the order of the goals, each once');
  const [project, life] = cards;
  assert.deepEqual(project.starters.map(({ id }) => id), GOAL_STARTERS.project);
  assert.deepEqual(life.starters.map(({ id }) => id), GOAL_STARTERS.life.filter(id => !GOAL_STARTERS.project.includes(id)));
  assert.deepEqual([life.starters.at(-1).title, life.starters.at(-1).source], ['My money', 'yours'], 'their own replaces hobkin\'s');
  const shown = cards.flatMap(({ starters, more }) => [...starters, ...more].map(({ id }) => id));
  assert.equal(new Set(shown).size, shown.length, 'each template shows once');
  const named = Object.values(byId).filter(({ goals }) => goals.some(goal => ['project', 'life'].includes(goal))).map(({ id }) => id);
  assert.deepEqual(shown.toSorted(), named.toSorted(), 'every template that names a picked goal shows');
  assert.ok(life.more.some(({ id }) => id === 'garden'), 'one of their own with only a group is more');
  for (const { goal, more } of cards) {
    for (const { id } of more) assert.equal(byId[id].goals.find(named => ['project', 'life'].includes(named)), goal, id);
    const place = ({ id }) => byId[id].goals.indexOf(goal);
    assert.deepEqual(more, more.toSorted((first, second) => place(first) - place(second) || first.id.localeCompare(second.id)), goal);
  }
  assert.deepEqual(Object.keys(project.starters[0]).toSorted(), ['asks', 'closes', 'effort', 'gives', 'id', 'needs', 'private', 'recurrence', 'skips', 'source', 'summary', 'tells', 'title', 'version']);
  assert.deepEqual(goalCards(root, []), []);
  assert.deepEqual(goalCards(root, ['job']).map(({ starters }) => starters.map(({ id }) => id)), [GOAL_STARTERS.job]);
});

test('a template of the user\'s own with only a group reads under the goal its group maps to, and one with neither is under none', t => {
  const root = home(t);
  const { group, ...neither } = garden;
  for (const old of ['day', 'week', 'life', 'code', 'machine']) yours(root, `${old}-own.md`, template({ ...garden, group: old }));
  yours(root, 'no-goal.md', template(neither));

  const { templates, errors } = listTemplates(root);

  assert.deepEqual(errors, []);
  const byId = byIdOf(templates);
  assert.deepEqual(['day', 'week', 'life', 'code', 'machine'].map(old => byId[`${old}-own`].goals), [['life'], ['life'], ['life'], ['code'], ['code']]);
  const { goals, tells, skips, gives, closes } = byId['no-goal'];
  assert.deepEqual([goals, tells, skips, gives, closes, byId['no-goal'].private], [[], null, null, [], null, false], 'the new keys may be left out');
  assert.equal(goalCards(root, TEMPLATE_GOALS).flatMap(({ starters, more }) => [...starters, ...more]).some(({ id }) => id === 'no-goal'), false);
});

test('hobkin\'s own templates need the new keys, and a template\'s own goals, outputs and private mark are checked', t => {
  const root = home(t);
  const folder = join(root, 'drafts');
  mkdirSync(folder);
  writeFileSync(join(folder, 'garden.md'), template(garden));

  assert.throws(() => readTemplate(join(folder, 'garden.md'), 'hobkin'), /goals, tells, gives, closes/);
  assert.equal(readTemplate(join(folder, 'garden.md'), 'yours').id, 'garden');

  const full = { ...garden, goals: 'life, project', tells: 'A bed that needs water.', skips: 'The lawn.', gives: 'report, action', closes: 'Their word.', private: 'yes' };
  yours(root, 'garden.md', template(full));
  yours(root, 'odd-goal.md', template({ ...full, goals: 'life, hobbies' }));
  yours(root, 'odd-gives.md', template({ ...full, gives: 'report, email' }));
  yours(root, 'odd-private.md', template({ ...full, private: 'maybe' }));
  const { templates, errors } = listTemplates(root);

  const garden_ = byIdOf(templates).garden;
  assert.deepEqual([garden_.goals, garden_.tells, garden_.skips, garden_.gives, garden_.closes, garden_.private], [['life', 'project'], 'A bed that needs water.', 'The lawn.', ['report', 'action'], 'Their word.', true]);
  const reported = Object.fromEntries(errors.map(({ file, message }) => [file.split('/').at(-1), message]));
  assert.deepEqual(Object.keys(reported).sort(), ['odd-gives.md', 'odd-goal.md', 'odd-private.md']);
  assert.match(reported['odd-goal.md'], /hobbies/);
  assert.match(reported['odd-gives.md'], /email/);
  assert.match(reported['odd-private.md'], /private/);
});

test('a template of your own joins the list by itself, and one named like a shipped one replaces it', t => {
  const root = home(t);
  yours(root, 'garden.md', template(garden));
  yours(root, 'morning-brief.md', template({ ...garden, title: 'My morning brief', group: 'day' }));

  const { templates } = listTemplates(root);

  const byId = Object.fromEntries(templates.map(entry => [entry.id, entry]));
  assert.deepEqual([byId.garden.title, byId.garden.source, byId.garden.needs, byId.garden.effort], ['Garden', 'yours', [], 'medium']);
  assert.match(byId.garden.file, /routines\/templates\/garden\.md$/);
  assert.equal(byId['morning-brief'].title, 'My morning brief');
  assert.equal(templates.filter(({ id }) => id === 'morning-brief').length, 1);
});

test('a template missing what setup needs is reported instead of listed, and a file that is not one is left alone', t => {
  const root = home(t);
  const { summary, ...noSummary } = garden;
  yours(root, 'no-summary.md', template(noSummary));
  yours(root, 'odd-group.md', template({ ...garden, group: 'hobbies' }));
  yours(root, 'README.md', 'How I write my templates.');

  const { templates, errors } = listTemplates(root);

  assert.equal(templates.some(({ id }) => ['no-summary', 'odd-group', 'README'].includes(id)), false);
  const reported = Object.fromEntries(errors.map(({ file, message }) => [file.split('/').at(-1), message]));
  assert.deepEqual(Object.keys(reported).sort(), ['no-summary.md', 'odd-group.md']);
  assert.match(reported['no-summary.md'], /summary/);
  assert.match(reported['odd-group.md'], /group/);
});

test('a template can carry its version and what setup asks before writing it', t => {
  const root = home(t);
  yours(root, 'garden.md', template({ ...garden, version: 3, asks: 'Which beds and crops should it keep track of?' }));
  yours(root, 'bad-version.md', template({ ...garden, version: 'two' }));

  const { templates, errors } = listTemplates(root);

  const byId = Object.fromEntries(templates.map(entry => [entry.id, entry]));
  assert.deepEqual([byId.garden.version, byId.garden.asks], [3, 'Which beds and crops should it keep track of?']);
  assert.deepEqual([byId['agent-sessions'].version, byId['agent-sessions'].asks], [1, null], 'no version means the first one');
  assert.match(errors.find(({ file }) => file.endsWith('bad-version.md')).message, /version/);
});

test('after an update hobkin says once which of its templates are new or newer, and its first look only remembers', t => {
  const root = home(t);
  assert.deepEqual(templateNews(root), { added: [], updated: [] }, 'the first look remembers what is there');
  const seenFile = join(root, 'runtime', 'templates-seen.json');
  const remembered = JSON.parse(readFileSync(seenFile, 'utf8'));
  delete remembered.seen['important-dates'];
  remembered.seen['morning-brief'] = 0;
  writeFileSync(seenFile, JSON.stringify(remembered));

  const news = templateNews(root);

  assert.deepEqual(news.added.map(({ id }) => id), ['important-dates']);
  assert.deepEqual(news.updated.map(({ id }) => id), ['morning-brief']);
  assert.match(templateNotice(news), /^A new routine template: Important dates\. Updated: Morning brief\./);
  assert.deepEqual(templateNews(root), { added: [], updated: [] }, 'told once');
  assert.equal(templateNotice({ added: [], updated: [] }), null);
});

test('a template of your own is never news, because you added it', t => {
  const root = home(t);
  templateNews(root);
  yours(root, 'garden.md', template(garden));

  assert.deepEqual(templateNews(root), { added: [], updated: [] });
});

test('hobkin routines templates prints the list and the rules for an agent', async t => {
  const root = home(t);
  yours(root, 'garden.md', template(garden));
  let text = '';

  const code = await main(['routines', 'templates', '--home', root], { write: chunk => { text += chunk; } }, { input: Readable.from([]) });

  const { templates, rules } = JSON.parse(text);
  assert.equal(code, 0);
  assert.ok(templates.some(({ id, source }) => id === 'garden' && source === 'yours'));
  assert.ok(templates.some(({ id }) => id === 'morning-brief'));
  assert.ok(rules.length > 0);
});
