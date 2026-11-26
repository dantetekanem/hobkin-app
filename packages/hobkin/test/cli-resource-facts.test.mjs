import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import resourceFacts, { RESOURCE_FACTS, createResourceFacts, factsFromUiRequest, readFacts } from '../src/cli/resource-facts-extension.mjs';
import { loadedFacts, readUse, recordUse, usedCounts, usePath, usesFromEvents } from '../src/cli/resource-use.mjs';

const hobkinOwn = new URL('../src/cli/hobkin-extension.mjs', import.meta.url).pathname;
const tool = (name, path, source = 'cli') => ({ name, description: `${name} tool`, parameters: {}, exposure: 'direct', sourceInfo: { path, source, scope: 'temporary', origin: 'top-level' } });

// The part of Pi's extension surface the facts extension touches: `on`, `getAllTools` and `ctx.ui.setStatus`.
function fakePi(tools) {
  const handlers = {};
  const statuses = [];
  const pi = { on: (event, handler) => { handlers[event] = handler; }, getAllTools: () => tools };
  const ctx = { cwd: '/work', ui: { setStatus: (key, text) => statuses.push({ key, text }) } };
  return { pi, ctx, handlers, statuses };
}

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-resource-use-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const web = { id: 'package:npm:@siddr/pi-web-search', type: 'package', extensions: ['/pi/npm/web/index.js'], skills: ['/pi/npm/web/skills/web/SKILL.md'], context: [] };
const humanizer = { id: 'skill:skills/humanizer/SKILL.md', type: 'skill', extensions: [], skills: ['/pi/skills/humanizer/SKILL.md'], context: [] };

test('a run reports from inside Pi its tools with their files, its skills and the context files Pi found', async () => {
  const tools = [tool('read', 'builtin:read', 'builtin'), tool('codemode', 'builtin:codemode', 'builtin'), tool('web_search', '/pi/npm/web/index.js', 'npm:@siddr/pi-web-search')];
  const { pi, ctx, handlers, statuses } = fakePi(tools);
  resourceFacts(pi);
  const event = {
    type: 'before_agent_start', prompt: 'Go.', systemPrompt: 'base',
    systemPromptOptions: {
      cwd: '/work', selectedTools: ['read'],
      skills: [{ name: 'web-search', description: 'Search', filePath: '/pi/npm/web/skills/web/SKILL.md', baseDir: '/pi/npm/web/skills/web', sourceInfo: { path: '/pi/npm/web/skills/web/SKILL.md', source: 'cli' } }],
      contextFiles: [{ path: '/work/AGENTS.md', content: 'Project rules that must not travel in the record' }],
    },
  };

  assert.equal(await handlers.before_agent_start(event, ctx), undefined, 'the facts never change the prompt');
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].key, RESOURCE_FACTS);
  const facts = readFacts(statuses[0].text);
  assert.deepEqual(facts.tools.map(({ name, path }) => [name, path]), [['read', 'builtin:read'], ['codemode', 'builtin:codemode'], ['web_search', '/pi/npm/web/index.js']]);
  assert.deepEqual(facts.skills, [{ name: 'web-search', path: '/pi/npm/web/skills/web/SKILL.md', source: 'cli' }]);
  assert.deepEqual(facts.contextFiles, [{ path: '/work/AGENTS.md' }]);
  assert.ok(!statuses[0].text.includes('must not travel'));

  // The record reaches hobkin the way the bridge's does: an RPC setStatus request under its own key.
  assert.deepEqual(factsFromUiRequest({ type: 'extension_ui_request', id: 'x', method: 'setStatus', statusKey: RESOURCE_FACTS, statusText: statuses[0].text }), facts);
  assert.equal(factsFromUiRequest({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'hobkin/bridge', statusText: statuses[0].text }), undefined);
  assert.equal(readFacts('{"version":1,"tools":"all"}'), undefined);
  assert.equal(readFacts('not json'), undefined);

  await handlers.before_agent_start(event, ctx);
  assert.equal(statuses.length, 2, 'one record each turn');

  const many = fakePi(Array.from({ length: 5000 }, (_, i) => tool(`t${i}`, `/x/${'p'.repeat(5000)}`)));
  resourceFacts(many.pi);
  await many.handlers.before_agent_start({ systemPromptOptions: {} }, many.ctx);
  assert.ok(Buffer.byteLength(many.statuses[0].text) <= 262144, 'the record stays well under what an RPC reader keeps');
  assert.equal(readFacts(many.statuses[0].text).truncated, true, 'and says it was cut short');
  assert.ok(readFacts(many.statuses[0].text).tools.length > 0);

  const broken = fakePi([]);
  broken.pi.getAllTools = () => { throw Error('Pi changed'); };
  resourceFacts(broken.pi);
  assert.equal(await broken.handlers.before_agent_start(event, broken.ctx), undefined, 'a turn never fails for its facts');

  const sent = [];
  const child = fakePi(tools);
  createResourceFacts((_ctx, record) => sent.push(record))(child.pi);
  await child.handlers.before_agent_start(event, child.ctx);
  assert.deepEqual(sent, [facts], 'a host without RPC can take the same record directly');
});

test('what loaded without being chosen is marked so', t => {
  const root = home(t);
  const chosenContext = join(root, 'chosen-AGENTS.md');
  writeFileSync(chosenContext, 'rules');
  const facts = {
    version: 1,
    tools: [
      { name: 'read', path: 'builtin:read', source: 'builtin' }, { name: 'codemode', path: 'builtin:codemode', source: 'builtin' },
      { name: 'tool_search', path: 'builtin:tool-search', source: 'builtin' }, { name: 'web_search', path: '/pi/npm/web/index.js', source: 'cli' },
      { name: 'hobkin_memory', path: '<sdk:hobkin_memory>', source: 'sdk' }, { name: 'question', path: hobkinOwn, source: 'cli' },
      { name: 'mcp__github__issues', path: 'builtin:mcp', source: 'builtin' }, { name: 'spawn_agent', path: '/pi/npm/teams/index.ts', source: 'npm:pi-extended-teams' },
    ],
    skills: [{ name: 'web-search', path: '/pi/npm/web/skills/web/SKILL.md' }, { name: 'stray', path: '/pi/skills/stray/SKILL.md' }],
    contextFiles: [{ path: '/work/AGENTS.md' }],
  };
  const chosen = [web, { id: 'context:pi', type: 'context', extensions: [], skills: [], context: [chosenContext, join(root, 'gone.md')] }];

  const loaded = loadedFacts(facts, { chosen });
  const as = list => Object.fromEntries(list.map(entry => [entry.name ?? entry.path, entry.id ? `${entry.origin}:${entry.id}` : entry.origin]));

  assert.deepEqual(as(loaded.tools), {
    read: 'pi', codemode: 'pi', tool_search: 'pi', web_search: `chosen:${web.id}`, hobkin_memory: 'hobkin', question: 'hobkin',
    mcp__github__issues: 'unchosen', spawn_agent: 'unchosen',
  });
  assert.deepEqual(as(loaded.skills), { 'web-search': `chosen:${web.id}`, stray: 'unchosen' });
  assert.deepEqual(as(loaded.contextFiles), { '/work/AGENTS.md': 'unchosen', [chosenContext]: 'chosen:context:pi', [join(root, 'gone.md')]: 'unreadable:context:pi' });
  assert.ok(loaded.tools.filter(entry => entry.origin === 'unchosen').every(entry => entry.reason === undefined));

  const managed = loadedFacts(facts, { chosen, managedExtensions: true });
  assert.equal(managed.tools.find(entry => entry.name === 'spawn_agent').reason, 'launcher');
  assert.equal(managed.tools.find(entry => entry.name === 'web_search').origin, 'chosen');
});

test("a chosen tool's call, from the model or a code mode script, and a read of a chosen skill count as uses", () => {
  const facts = loadedFacts({
    version: 1,
    tools: [{ name: 'read', path: 'builtin:read' }, { name: 'web_search', path: '/pi/npm/web/index.js' }, { name: 'spawn_agent', path: '/pi/npm/teams/index.ts' }],
    skills: [], contextFiles: [],
  }, { chosen: [web, humanizer] });
  const start = (toolCallId, toolName, args = {}, parentToolCallId) => ({ type: 'tool_execution_start', toolCallId, toolName, args, ...(parentToolCallId ? { parentToolCallId } : {}) });
  const events = [
    start('1', 'web_search', { query: 'x' }),
    { type: 'tool_execution_end', toolCallId: '1', toolName: 'web_search', result: {}, isError: false },
    start('2', 'codemode', { code: 'await tools.web_search({ query: "y" })' }),
    start('3', 'web_search', { query: 'y' }, '2'),
    start('4', 'read', { path: 'skills/humanizer/SKILL.md' }),
    start('5', 'read', { path: '@/pi/npm/web/skills/web/SKILL.md' }, '2'),
    start('6', 'read', { path: '/pi/skills/humanizer/notes.md' }),
    start('7', 'spawn_agent', { name: 'helper' }),
    start('1', 'web_search', { query: 'x' }),
    { type: 'message_end', message: { role: 'assistant' } },
  ];

  const uses = usesFromEvents(events, { loaded: facts, chosen: [web, humanizer], cwd: '/pi' });

  assert.deepEqual(uses.map(use => [use.call, use.id]), [['1', web.id], ['3', web.id], ['4', humanizer.id], ['5', web.id]]);
  assert.deepEqual(uses.map(use => use.by), ['tool', 'tool', 'skill', 'skill']);
  assert.deepEqual(usedCounts(uses), [{ id: web.id, count: 3 }, { id: humanizer.id, count: 1 }]);
});

test('uses stay in the home for 30 days and no telemetry event carries them', t => {
  const root = home(t);
  const day = 86400000;
  const now = Date.parse('2026-11-13T12:00:00Z');
  const at = ago => new Date(now - ago).toISOString();
  const loaded = { chosen: [{ id: web.id, tools: ['web_search'] }], unchosen: [], missing: [] };

  recordUse(root, { kind: 'work', run: 'old-run', at: at(31 * day), used: [{ id: web.id, count: 9 }] }, { now: now - 31 * day });
  recordUse(root, { kind: 'work', run: 'run-1', at: at(2 * day), loaded, used: [{ id: web.id, count: 2 }] }, { now: now - 2 * day });
  recordUse(root, { kind: 'main', run: 'main-session', at: at(day), loaded: { chosen: [], unchosen: [], missing: [] } }, { now: now - day });

  const before = readUse(root, { now });
  assert.deepEqual(before.work.uses, { [web.id]: { count: 2, last: at(2 * day) } }, 'a use older than 30 days is not counted');
  assert.deepEqual(before.work.loaded, { at: at(2 * day), run: 'run-1', ...loaded });
  assert.deepEqual(before.main.uses, {});
  assert.equal(before.background.loaded, null);
  assert.ok(readFileSync(usePath(root), 'utf8').includes('old-run'), 'nothing is pruned before the next write');

  recordUse(root, { kind: 'work', run: 'run-2', at: at(0), used: [{ id: web.id, count: 1 }] }, { now });
  const lines = readFileSync(usePath(root), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(lines.map(line => line.run), ['run-1', 'main-session', 'run-2'], 'the next write drops what is older than 30 days');
  assert.deepEqual(readUse(root, { now }).work.uses, { [web.id]: { count: 3, last: at(0) } });

  assert.deepEqual(readdirSync(root), ['resources']);
  assert.deepEqual(readdirSync(join(root, 'resources')), ['use.jsonl']);
  assert.ok(!existsSync(join(root, 'runtime', 'telemetry.jsonl')), 'no telemetry event carries a use');

  for (const entry of [{ kind: 'reflection', run: 'x', at: at(0) }, { kind: 'work', run: '', at: at(0) }, { kind: 'work', run: 'x', at: 'yesterday' },
    { kind: 'work', run: 'x', at: at(0), used: [{ id: '/a/path.ts', count: 1 }] }, { kind: 'work', run: 'x', at: at(0), used: [{ id: web.id, count: 0 }] }]) {
    assert.throws(() => recordUse(root, entry, { now }), /use/i, JSON.stringify(entry));
  }
  mkdirSync(join(root, 'resources'), { recursive: true });
  writeFileSync(usePath(root), `${readFileSync(usePath(root), 'utf8')}not json\n`);
  assert.deepEqual(readUse(root, { now }).work.uses, { [web.id]: { count: 3, last: at(0) } }, 'a damaged line is skipped, not fatal');
  assert.deepEqual(readUse(home(t), { now }).work, { loaded: null, uses: {} });
});
