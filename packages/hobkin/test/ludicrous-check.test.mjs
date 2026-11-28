import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { git, repository } from './helpers/work-fixture.mjs';

const CHECK = fileURLToPath(new URL('../src/skills/ludicrous-leader/check.mjs', import.meta.url));
const BRANCH = 'ludicrous/harbor';
const exec = promisify(execFile);

// A check command a test can watch: it writes when it starts and ends, and fails unless it sees the committed file.
const RECORD = `import { appendFileSync, readFileSync } from 'node:fs';
const [area] = process.argv.slice(2);
appendFileSync(process.env.RECORD_LOG, \`start \${area} \${Date.now()}\\n\`);
await new Promise(done => setTimeout(done, 400));
appendFileSync(process.env.RECORD_LOG, \`end \${area} \${Date.now()}\\n\`);
process.exit(readFileSync('src/app.txt', 'utf8') === 'committed\\n' ? 0 : 1);
`;

function run(t, { api = ['node checks/record.mjs api'], web = ['node checks/record.mjs web'] } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-ludicrous-check-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const checkout = repository(base, 'harbor');
  const baseCommit = git(checkout, 'rev-parse', 'HEAD');
  git(checkout, 'switch', '-q', '-c', BRANCH);
  mkdirSync(join(checkout, 'checks'));
  mkdirSync(join(checkout, 'src'));
  mkdirSync(join(checkout, '_specs', 'ludicrous', 'trails', 'api'), { recursive: true });
  writeFileSync(join(checkout, 'checks', 'record.mjs'), RECORD);
  writeFileSync(join(checkout, 'src', 'app.txt'), 'committed\n');
  writeFileSync(join(checkout, '_specs', 'ludicrous', 'plan.json'), JSON.stringify({ areas: [{ id: 'api', checks: api }, { id: 'web', checks: web }] }));
  writeFileSync(join(checkout, '_specs', 'ludicrous', 'trails', 'api', 'queue.jsonl'), `${JSON.stringify({ id: 'api-3', step: 'S2', paths: ['src/app.txt'], tier: 'mid' })}\n`);
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-qm', 'api-3: the app\n\nPacket: api-3');
  // Another worker's file, half written in the shared folder and never committed.
  writeFileSync(join(checkout, 'src', 'app.txt'), 'half-writ');
  const directory = join(base, 'run');
  return { base, checkout, baseCommit, directory, checks: join(base, 'trees'), log: join(base, 'record.log') };
}

function check(h, area, slots = 1) {
  const env = {
    ...process.env, RECORD_LOG: h.log, LUDICROUS_BRANCH: BRANCH, LUDICROUS_AREA: area, LUDICROUS_BASE: h.baseCommit,
    LUDICROUS_RUN: h.directory, LUDICROUS_CHECKS: h.checks, LUDICROUS_CHECK_SLOTS: String(slots), LUDICROUS_CHECK_POLL_MS: '50',
  };
  return exec(process.execPath, [CHECK], { cwd: h.checkout, env }).then(({ stdout }) => ({ code: 0, stdout }), error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
}

const marks = log => readFileSync(log, 'utf8').trim().split('\n').map(line => {
  const [what, area, at] = line.split(' ');
  return { what, area, at: Number(at) };
});

test('a leader checks only a committed head, one check an area, and waits for a free check worktree', async t => {
  const h = run(t);
  const head = git(h.checkout, 'rev-parse', BRANCH);
  const [api, again, web] = await Promise.all([check(h, 'api'), check(h, 'api'), check(h, 'web')]);

  // Both checks that ran saw the committed file, never the half-written one in the shared folder.
  const ran = [api, again].filter(({ code }) => code !== 3);
  assert.equal(ran.length, 1);
  assert.equal(ran[0].code, 0);
  assert.match([api, again].find(({ code }) => code === 3).stderr, /A check of api is running already/);
  assert.equal(web.code, 0);

  // One worktree, so web waited until api's check had ended.
  const seen = marks(h.log);
  assert.deepEqual(seen.map(({ what, area }) => `${what} ${area}`).sort(), ['end api', 'end web', 'start api', 'start web']);
  const [first, second] = ['api', 'web'].map(area => ({ start: seen.find(m => m.what === 'start' && m.area === area).at, end: seen.find(m => m.what === 'end' && m.area === area).at }))
    .sort((a, b) => a.start - b.start);
  assert.ok(second.start >= first.end);

  // The run's only worktree sits at the branch's head.
  const worktrees = git(h.checkout, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9));
  assert.deepEqual(worktrees, [h.checkout, join(h.checks, 'ludicrous-check-1')]);
  assert.equal(git(join(h.checks, 'ludicrous-check-1'), 'rev-parse', 'HEAD'), head);
  const status = JSON.parse(readFileSync(join(h.checkout, '_specs', 'ludicrous', 'trails', 'api', 'status.json'), 'utf8'));
  assert.deepEqual(status.checked, { head, passed: true, at: status.checked.at });
});

test('a failing check files a fix packet naming the check, the commit and the trail', async t => {
  const h = run(t, { api: ['node checks/record.mjs api', 'test -e docs/missing.md'] });
  const commit = git(h.checkout, 'rev-parse', BRANCH);
  const failed = await check(h, 'api');
  assert.equal(failed.code, 1);
  assert.match(failed.stdout, /api failed at test -e docs\/missing\.md on [0-9a-f]{12}/);

  const queue = readFileSync(join(h.checkout, '_specs', 'ludicrous', 'trails', 'api', 'queue.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(queue.at(-1), {
    id: 'api-fix-1',
    step: 'S2',
    title: 'Fix the failing check: test -e docs/missing.md',
    paths: ['src/app.txt'],
    tier: 'mid',
    fix: { check: 'test -e docs/missing.md', commit, trail: '_specs/ludicrous/trails/api/api-3.md', head: commit },
  });
  const result = JSON.parse(readFileSync(join(h.directory, 'checks', 'api.json'), 'utf8'));
  assert.equal(result.passed, false);
  assert.equal(result.failed.command, 'test -e docs/missing.md');
  assert.ok(existsSync(result.log));

  // Nothing new committed since, so checking again runs nothing.
  const again = await check(h, 'api');
  assert.equal(again.code, 1);
  assert.match(again.stdout, /Nothing new in api since [0-9a-f]{12}, which failed/);
});
