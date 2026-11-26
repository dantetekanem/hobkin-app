import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInvocation } from '../src/cli/harnesses.mjs';
import { editReport } from '../src/cli/report-editor.mjs';

const binding = { harness: 'pi', model: 'openai/checks', effort: 'medium' };
const draft = [
  'Useful: Fixed transaction reuse on `hobkin/7298ae` (`7aad136`).',
  '',
  'Verified: six selected cases / 41 assertions pass. See https://example.com/run/9.',
].join('\n');
const human = [
  'Useful: One transaction can no longer be matched twice. The fix is on `hobkin/7298ae` (`7aad136`).',
  '',
  'All six selected cases pass, with 41 assertions. The run is at https://example.com/run/9.',
].join('\n');

function home(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-report-editor-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function editor(t, reply, options = {}) {
  const root = home(t);
  const requests = [];
  const runHarness = async request => {
    requests.push(request);
    return typeof reply === 'function' ? reply(request) : { status: 'completed', text: reply };
  };
  const edit = result => editReport(result, { root, binding, runHarness, ...options });
  return { edit, requests, root };
}

const finished = text => ({ status: 'completed', text, cost: null });

test('a finished report comes back in the editor\'s words, from a job of its own', async t => {
  const { edit, requests, root } = editor(t, human);

  const result = await edit(finished(draft));

  assert.equal(result.text, human);
  assert.equal(result.editedBy, requests[0].id, 'the draft stays in that job\'s session');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].purpose, 'humanizer');
  assert.equal(requests[0].model, 'openai/checks');
  assert.equal(requests[0].prompt, draft);
  assert.ok(existsSync(join(root, 'jobs')), 'the job needs a folder for its session');
});

test('what is not a report the user reads costs nothing', async t => {
  const { edit, requests } = editor(t, human);
  const left = [
    finished('Nothing new.'),
    finished('{"decisions":[]}'),
    { status: 'failed', text: draft, error: 'It broke.', cost: null },
    { status: 'interrupted', text: '', cost: null },
  ];

  for (const result of left) assert.deepEqual(await edit(result), result);

  assert.deepEqual(requests, []);
});

test('an edit that changes a fact is thrown away, because a report is evidence', async t => {
  const changes = {
    'a number lost': human.replace(', with 41 assertions', ''),
    'a number added': `${human} It took 12 minutes.`,
    'a link lost': human.replace('The run is at https://example.com/run/9.', ''),
    'code lost': human.replace(' (`7aad136`)', ''),
    'the label changed': human.replace('Useful:', 'Critical:'),
    'a preamble before the label': `Here is the report:\n\n${human}`,
    'nothing left': '',
  };

  for (const [name, reply] of Object.entries(changes)) {
    const { edit } = editor(t, reply);

    assert.equal((await edit(finished(draft))).text, draft, name);
  }
});

test('the one call a report asks for survives the edit, or the edit is thrown away', async t => {
  const withNext = text => text.replace('\n\n', '\n\nNext: Merge the branch.\n\n');
  const changes = {
    'kept': [withNext(human), withNext(human)],
    'lost': [human, withNext(draft)],
    'reworded': [withNext(human).replace('Merge the branch', 'Land it'), withNext(draft)],
  };

  for (const [name, [reply, delivered]] of Object.entries(changes)) {
    const { edit } = editor(t, reply);

    assert.equal((await edit(finished(withNext(draft)))).text, delivered, name);
  }
});

test('code the editor only formats differently still counts as kept', async t => {
  const plain = draft.replace('`hobkin/7298ae`', 'hobkin/7298ae');
  const { edit } = editor(t, human);

  assert.equal((await edit(finished(plain))).text, human);
});

test('a report the editor cannot reach is delivered as it was written', async t => {
  const failures = {
    'the job fails': () => ({ status: 'failed', text: '', error: 'No model.' }),
    'the job throws': () => { throw Error('Pi is gone.'); },
    'the job is cut short': () => ({ status: 'interrupted', text: human }),
  };

  for (const [name, reply] of Object.entries(failures)) {
    const { edit } = editor(t, reply);

    assert.equal((await edit(finished(draft))).text, draft, name);
  }
});

test('the editor has a time limit, and a cancelled run skips it', { timeout: 5000 }, async t => {
  // Unlike a real harness process, this promise cannot keep AbortSignal.timeout alive.
  const keepAlive = setTimeout(() => {}, 5000);
  t.after(() => clearTimeout(keepAlive));
  const stuck = request => new Promise((_, reject) => {
    request.signal.addEventListener('abort', () => reject(Error('Timed out.')), { once: true });
  });
  const { edit } = editor(t, stuck, { timeLimitMs: 5 });

  assert.equal((await edit(finished(draft))).text, draft);

  const cancelled = editor(t, human, { signal: AbortSignal.abort() });
  assert.equal((await cancelled.edit(finished(draft))).text, draft);
  assert.deepEqual(cancelled.requests, []);
});

test('a report too long for one job stays as it is', async t => {
  const { edit, requests } = editor(t, human);
  const long = `${draft}\n\n${'A long line of findings.\n'.repeat(4000)}`;

  assert.equal((await edit(finished(long))).text, long);
  assert.deepEqual(requests, []);
});

test('the editor runs with no tools, no extensions and the guide Hobkin ships', t => {
  const root = home(t);
  const { args } = buildInvocation({
    id: '6f9619ff-8b86-4011-b42d-00c04fc964ff',
    harness: 'pi',
    purpose: 'humanizer',
    cwd: root,
    sessionFile: join(root, 'job.jsonl'),
    prompt: draft,
    ...binding,
  });

  assert.ok(args.includes('--no-tools'));
  assert.ok(args.includes('--no-extensions'));
  assert.ok(args.includes('--no-context-files'));
  const system = args[args.indexOf('--system-prompt') + 1];
  assert.match(system, /Humanizer: remove AI writing patterns/);
  assert.match(system, /Keep every number/);
});

test('the guide ships with its license', () => {
  const license = readFileSync(new URL('../src/prompts/humanizer.LICENSE', import.meta.url), 'utf8');

  assert.match(license, /MIT License/);
  assert.match(license, /Siqi Chen/);
});
