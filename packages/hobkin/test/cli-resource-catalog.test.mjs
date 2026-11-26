import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Pi reads skills from $HOME/.agents and falls back to ~/.pi/agent when no folder is named. Neither may be the real one here.
const fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-catalog-home-')));
process.env.HOME = fakeHome;
process.env.PI_CODING_AGENT_DIR = join(fakeHome, 'no-such-pi-folder');
after(() => rmSync(fakeHome, { recursive: true, force: true }));

const { buildCatalog } = await import('../src/cli/resource-catalog.mjs');
const { changeSelection } = await import('../src/cli/resource-policy.mjs');

const write = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const skill = (file, name, description) => write(file, `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`);
// An extension that leaves a mark if anything runs it.
const extension = (file, mark) => write(file, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(mark)}, 'ran');\nexport default function () {}\n`);
const pkg = (folder, manifest) => write(join(folder, 'package.json'), JSON.stringify(manifest));

function folders(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-catalog-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const agentDir = join(base, 'agent'), project = join(base, 'project'), root = join(base, 'hobkin');
  for (const folder of [agentDir, project, root]) mkdirSync(folder, { recursive: true });
  return { base, agentDir, project, root, mark: join(base, 'ran') };
}

function tree(folder) {
  const found = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      found.push(`${path}:${statSync(path).size}`);
      if (statSync(path).isDirectory()) walk(path);
    }
  };
  walk(folder);
  return found.sort();
}

const byId = catalog => new Map(catalog.items.map(item => [item.id, item]));

test('the catalog lists what Pi has on at user level and installs nothing', async t => {
  const { base, agentDir, mark } = folders(t);
  const npmLog = join(base, 'npm-calls.log');
  const fakeNpm = join(base, 'fake-npm.mjs');
  write(fakeNpm, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(npmLog)}, process.argv.slice(2).join(' ') + '\\n');\nprocess.exit(1);\n`);
  write(join(agentDir, 'settings.json'), JSON.stringify({
    npmCommand: [process.execPath, fakeNpm],
    packages: ['npm:@scope/pi-web', '../tools/pi-local', 'npm:pi-missing', 'git:github.com/example/pi-gone'],
    extensions: ['../loose/loose-ext.ts', '-builtin:llama.cpp'],
    skills: ['../loose-skills/outside'],
  }));
  const web = join(agentDir, 'npm', 'node_modules', '@scope', 'pi-web');
  pkg(web, { name: '@scope/pi-web', version: '1.0.0', description: 'Search the web', pi: { extensions: ['./index.js'], skills: ['./skills'] } });
  extension(join(web, 'index.js'), mark);
  skill(join(web, 'skills', 'web-search', 'SKILL.md'), 'web-search', 'Search with a query');
  const local = join(base, 'tools', 'pi-local');
  pkg(local, { name: 'pi-local', description: 'Local tools', pi: { extensions: ['./ext.mjs'] } });
  extension(join(local, 'ext.mjs'), mark);
  extension(join(agentDir, 'extensions', 'mine.ts'), mark);
  pkg(join(agentDir, 'extensions', 'folder-ext'), { name: 'folder-ext', description: 'A folder extension' });
  extension(join(agentDir, 'extensions', 'folder-ext', 'index.ts'), mark);
  extension(join(base, 'loose', 'loose-ext.ts'), mark);
  skill(join(agentDir, 'skills', 'humanize', 'SKILL.md'), 'humanize', 'Rewrite prose plainly');
  skill(join(base, 'loose-skills', 'outside', 'SKILL.md'), 'outside', 'A skill outside the Pi folder');
  write(join(agentDir, 'AGENTS.md'), '# Global rules\n\nBe brief.\n');
  write(join(agentDir, 'prompts', 'template.md'), 'A prompt template');
  write(join(agentDir, 'themes', 'dark.json'), '{}');
  skill(join(fakeHome, '.agents', 'skills', 'home-skill', 'SKILL.md'), 'home-skill', 'Found in the home .agents folder');
  const before = tree(agentDir);

  const catalog = await buildCatalog({ agentDir });
  const items = byId(catalog);

  assert.deepEqual([...items.keys()].sort(), [
    'builtin:mcp', 'context:folder', 'context:pi',
    'extension:extensions/folder-ext/index.ts', `extension:${join(base, 'loose', 'loose-ext.ts')}`, 'extension:extensions/mine.ts',
    'package:../tools/pi-local', 'package:npm:@scope/pi-web',
    `skill:${join(base, 'loose-skills', 'outside', 'SKILL.md')}`, 'skill:skills/humanize/SKILL.md',
  ].sort());
  for (const item of catalog.items) {
    assert.ok(item.name && typeof item.name === 'string', `${item.id} has a name`);
    assert.equal(typeof item.line, 'string', `${item.id} has a line`);
    assert.equal(typeof item.from, 'string', `${item.id} says where it comes from`);
  }
  const webItem = items.get('package:npm:@scope/pi-web');
  assert.equal(webItem.type, 'package');
  assert.equal(webItem.name, '@scope/pi-web');
  assert.equal(webItem.line, 'Search the web');
  assert.equal(webItem.from, web);
  assert.deepEqual(webItem.holds.skills.map(held => held.name), ['web-search']);
  assert.deepEqual(webItem.paths.extensions, [join(web, 'index.js')]);
  assert.deepEqual(webItem.paths.skills, [join(web, 'skills', 'web-search', 'SKILL.md')]);
  assert.equal(webItem.holds.extensions.length, 1);
  assert.equal(items.get('package:../tools/pi-local').name, 'pi-local');
  const humanize = items.get('skill:skills/humanize/SKILL.md');
  assert.equal(humanize.name, 'humanize');
  assert.equal(humanize.line, 'Rewrite prose plainly');
  assert.equal(items.get('extension:extensions/folder-ext/index.ts').name, 'folder-ext');
  assert.equal(items.get('extension:extensions/folder-ext/index.ts').line, 'A folder extension');
  assert.equal(items.get('extension:extensions/mine.ts').name, 'mine');
  assert.deepEqual(items.get('context:pi').paths.context, [join(agentDir, 'AGENTS.md')]);
  assert.equal(items.get('context:pi').line, 'Global rules');
  assert.deepEqual(items.get('builtin:mcp').paths.extensions, ['builtin:mcp']);

  assert.ok(!existsSync(mark), 'building the catalog runs no extension');
  assert.ok(!readFileSync(npmLog, 'utf8').split('\n').some(call => /\b(install|add|update)\b/.test(call)), 'npm installs nothing');
  assert.deepEqual(tree(agentDir), before, 'nothing is written into the Pi folder');
});

test('pi-emote is never offered, and the three the main chat leaves out are offered to the other kinds only', async t => {
  const { base, agentDir } = folders(t);
  const names = ['pi-emote', 'pi-memory', 'pi-scheduler', 'pi-cache-compact-preserved-messages', 'pi-chrome'];
  write(join(agentDir, 'settings.json'), JSON.stringify({ packages: names.map(name => `../packages/${name}`) }));
  for (const name of names) {
    pkg(join(base, 'packages', name), { name, pi: { extensions: ['./index.mjs'] } });
    write(join(base, 'packages', name, 'index.mjs'), 'export default function () {}\n');
  }

  const catalog = await buildCatalog({ agentDir });
  const items = byId(catalog);
  const offered = name => items.get(`package:../packages/${name}`).offered;

  assert.deepEqual(offered('pi-emote'), { main: false, background: false, work: false, durable: false });
  for (const name of ['pi-memory', 'pi-scheduler', 'pi-cache-compact-preserved-messages']) {
    assert.deepEqual(offered(name), { main: false, background: true, work: true, durable: true }, name);
    assert.equal(typeof items.get(`package:../packages/${name}`).notOffered.main, 'string', `${name} says why not the main chat`);
  }
  assert.deepEqual(offered('pi-chrome'), { main: true, background: true, work: true, durable: true });
  assert.deepEqual(items.get('builtin:mcp').offered, { main: false, background: true, work: true, durable: true });
  for (const kind of ['main', 'background', 'work', 'durable']) {
    assert.throws(() => changeSelection(undefined, { kind, on: ['package:../packages/pi-emote'] }, catalog), /offered/);
  }
  assert.throws(() => changeSelection(undefined, { kind: 'main', on: ['package:../packages/pi-memory'] }, catalog), /offered/);
  assert.deepEqual(changeSelection(undefined, { kind: 'work', on: ['package:../packages/pi-memory'] }, catalog).kinds.work, ['package:../packages/pi-memory']);
});

test("nothing in a folder's .pi is listed", async t => {
  const { agentDir, project, mark } = folders(t);
  write(join(agentDir, 'settings.json'), '{}');
  write(join(project, '.pi', 'settings.json'), JSON.stringify({ packages: ['../proj-pkg'], extensions: ['./x.ts'], skills: ['./s'] }));
  pkg(join(project, 'proj-pkg'), { name: 'proj-pkg', pi: { extensions: ['./index.mjs'] } });
  extension(join(project, 'proj-pkg', 'index.mjs'), mark);
  extension(join(project, '.pi', 'x.ts'), mark);
  skill(join(project, '.pi', 's', 'SKILL.md'), 's', 'Named by the folder settings');
  extension(join(project, '.pi', 'extensions', 'proj.ts'), mark);
  skill(join(project, '.pi', 'skills', 'proj-skill', 'SKILL.md'), 'proj-skill', 'A project skill');
  skill(join(project, '.agents', 'skills', 'agent-skill', 'SKILL.md'), 'agent-skill', 'A project .agents skill');
  write(join(project, '.pi', 'mcp.json'), JSON.stringify({ mcpServers: { project: { command: 'never' } } }));
  write(join(project, '.pi', 'AGENTS.md'), 'Inside .pi');

  const catalog = await buildCatalog({ agentDir, cwd: project });
  const paths = catalog.items.flatMap(item => [item.from, ...item.paths.extensions, ...item.paths.skills, ...item.paths.context]);

  assert.deepEqual(catalog.items.map(item => item.id).sort(), ['builtin:llama.cpp', 'builtin:mcp', 'context:folder']);
  assert.deepEqual(paths.filter(path => [join(project, '.pi'), join(project, '.agents'), join(project, 'proj-pkg')].some(folder => path.startsWith(folder))), []);
  assert.ok(!existsSync(mark));
});

test("the folder's own context files leave out Pi's own and hobkin's directions", async t => {
  const { agentDir, root } = folders(t);
  write(join(agentDir, 'settings.json'), '{}');
  write(join(agentDir, 'AGENTS.md'), 'Pi rules');
  write(join(root, 'AGENTS.md'), "hobkin's directions");
  const work = join(root, 'work', 'project');
  write(join(work, 'CLAUDE.md'), 'Project rules');
  write(join(root, 'work', 'AGENTS.md'), 'Work rules');

  const catalog = await buildCatalog({ agentDir, root, cwd: work });
  const items = byId(catalog);

  const folderFiles = items.get('context:folder').paths.context;
  assert.ok(folderFiles.includes(join(work, 'CLAUDE.md')));
  assert.ok(folderFiles.includes(join(root, 'work', 'AGENTS.md')));
  assert.ok(!folderFiles.includes(join(root, 'AGENTS.md')), "hobkin's directions never come in a second time");
  assert.ok(!folderFiles.includes(join(agentDir, 'AGENTS.md')), "Pi's AGENTS.md is context:pi, not the folder's");
  assert.deepEqual(items.get('context:pi').paths.context, [join(agentDir, 'AGENTS.md')]);
  assert.deepEqual((await buildCatalog({ agentDir, root })).items.find(item => item.id === 'context:folder').paths.context, []);
});

test('the catalog reads only the Pi folder it is given', async () => {
  for (const agentDir of [undefined, '', 'relative/agent']) {
    await assert.rejects(buildCatalog({ agentDir }), /Pi folder/);
  }
});

test("hobkin's own instructions are named for each kind from the files its runs read", async t => {
  const { project } = folders(t);
  const catalog = await buildCatalog({ agentDir: join(project, 'empty-agent') });
  const files = kind => catalog.hobkin[kind].filter(part => part.path).map(part => part.path);
  const text = path => readFileSync(path, 'utf8');
  const { buildInvocation } = await import('../src/cli/harnesses.mjs');
  const appended = args => args.flatMap((arg, at) => (arg === '--append-system-prompt' ? [args[at + 1]] : []));
  const run = purpose => buildInvocation({
    id: 'f094b0ba-036c-4abc-9198-745fd1226765', harness: 'pi', cwd: project, model: null, effort: 'medium',
    prompt: 'Go.', sessionFile: join(project, 'run.jsonl'), extensions: [], ...(purpose ? { purpose } : {}),
  }).args;

  for (const kind of ['main', 'background', 'work', 'durable']) {
    assert.ok(catalog.hobkin[kind].length > 0, kind);
    for (const path of files(kind)) assert.ok(statSync(path).isFile(), path);
  }
  assert.deepEqual(appended(run()), files('background').map(text));
  const [background, ...workFiles] = files('work');
  for (const purpose of ['work-discover', 'work-look', 'work-do']) {
    const own = workFiles.find(path => path.endsWith(`${purpose}.md`));
    assert.deepEqual(appended(run(purpose)), [text(background), text(own)], purpose);
  }
  const { durableDirections } = await import('../src/cli/hobkins.mjs');
  const durable = durableDirections('hobkin-test');
  for (const path of files('durable')) assert.ok(durable.includes(text(path).trim()), path);
  assert.equal(files('durable').length, 2);

  const main = await mainChatPrompts(t);
  assert.equal(main.length, files('main').length);
  files('main').forEach((path, at) => assert.ok(main[at].startsWith(text(path).split('{{runtime}}')[0]), path));
});

// The main chat's prompts as it hands them to Pi, through the same fakes as cli-sdk-resources: nothing real is loaded or run.
async function mainChatPrompts(t) {
  const { default: childProcess } = await import('node:child_process');
  const { syncBuiltinESMExports } = await import('node:module');
  const refuse = () => { throw Error('Real SDK, provider or process execution forbidden'); };
  t.mock.method(globalThis, 'fetch', refuse);
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) t.mock.method(childProcess, name, refuse);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const { openPiSession } = await import('../src/cli/pi-session.mjs');
  const { initialize } = await import('../src/cli/config.mjs');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-catalog-main-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root });
  config.main = { cwd: root, effort: 'medium' };
  let loaderOptions, sessionOptions;
  const session = { model: null, thinkingLevel: 'medium', dispose() {}, bindExtensions: async () => {}, getActiveToolNames: () => sessionOptions.tools };
  await openPiSession({ root, config }, {
    agentDir: join(root, 'agent'),
    loadSdk: async () => ({
      SessionManager: { open: () => ({ getSessionId: () => 'fake' }) },
      SettingsManager: { create: () => ({ applyOverrides() {} }), inMemory: value => ({ isolated: value }) },
      DefaultResourceLoader: class {
        constructor(options) { loaderOptions = options; }
        async reload() {}
        getExtensions() { return { extensions: loaderOptions.additionalExtensionPaths.map(path => ({ path })), errors: [] }; }
        getSkills() { return { skills: [], diagnostics: [] }; }
        getPrompts() { return { prompts: [], diagnostics: [] }; }
      },
      ModelRuntime: { create: refuse }, createAgentSession: refuse,
      createCodemodeExtension: () => () => {}, createToolSearchExtension: () => () => {}, createMcpExtension: refuse,
    }),
    createSession: async options => { sessionOptions = options; return { session }; },
  });
  return loaderOptions.appendSystemPrompt;
}
