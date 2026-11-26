import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { initialize } from '../src/cli/config.mjs';
import { main } from '../src/cli/main.mjs';
import { listTemplates, TEMPLATE_GROUPS, templateNews, templateNotice } from '../src/cli/routine-templates.mjs';

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

test('every template hobkin ships has what setup matches on, with the rules every routine keeps', t => {
  const { templates, errors, rules } = listTemplates(home(t));

  assert.deepEqual(errors, []);
  assert.ok(templates.length >= 25);
  for (const { id, title, summary, recurrence, fits, group, source } of templates) {
    assert.ok(title && summary && recurrence && fits, id);
    assert.ok(TEMPLATE_GROUPS.includes(group), id);
    assert.equal(source, 'hobkin', id);
  }
  assert.match(rules, /Nothing new\./);
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
