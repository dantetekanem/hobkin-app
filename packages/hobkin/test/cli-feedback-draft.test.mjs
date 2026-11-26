import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chatDraft, clientFacts, draftFeedback, feedbackQuestion, MAX_MESSAGE_CHARACTERS, redact } from '../src/cli/feedback/draft.mjs';

const NOW = Date.parse('2026-11-03T12:34:56.789Z');
const ID = '33333333-3333-4333-8333-333333333333';
const CLIENT = { hobkin_version: '0.1.6', platform: 'darwin', arch: 'arm64', node_version: '24.0.0', harness: 'pi' };
const HOME = '/Users/jane';
const sha256 = text => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

// What the server refuses as unsafe content. A placeholder must never trip these, or a redacted report could not go.
const serverRefuses = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/i,
  /\b(?:bearer|basic)\s+[A-Za-z0-9+/_=.-]{8,}/i,
  /\b(?:password|passwd|secret|token|api[_ -]?key|authorization)\s*[:=]\s*\S+/i,
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
];

test('redaction takes out emails, tokens and keys, credential URLs and home paths', () => {
  const secrets = {
    email: 'jane.doe+hobkin@example.com',
    anthropic: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
    github: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    pat: 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
    aws: 'AKIAABCDEFGHIJKLMNOP',
    slack: 'xoxb-123456789012-abcdefghijkl',
    google: 'AIzaSyA-abcdefghijklmnopqrstuvwxyz01234',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    hex: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    bearer: 'abc.def.ghi-jkl_mno',
    password: 'hunter2!',
    userinfo: 'bob:s3cret',
    query: 'xyz789',
    key: 'b3BlbnNzaC1rZXktdjEAAAAA',
  };
  const text = [
    `Mail me at ${secrets.email}.`,
    `Keys ${secrets.anthropic}, ${secrets.github} and ${secrets.pat}.`,
    `AWS ${secrets.aws}, Slack ${secrets.slack}, Google ${secrets.google}`,
    `JWT ${secrets.jwt} and hex ${secrets.hex}`,
    `Authorization: Bearer ${secrets.bearer}`,
    `password=${secrets.password}`,
    `Clone https://${secrets.userinfo}@git.example.com/repo.git`,
    `Callback https://example.com/cb?page=2&token=${secrets.query}`,
    `Files ${HOME}/Projects/app/src/index.ts, /Users/sam/notes.txt and /home/sam/todo.md`,
    `-----BEGIN OPENSSH PRIVATE KEY-----\n${secrets.key}\n-----END OPENSSH PRIVATE KEY-----`,
  ].join('\n');

  const redacted = redact(text, { home: HOME });

  for (const [name, value] of Object.entries(secrets)) assert.equal(redacted.includes(value), false, `${name} is gone`);
  for (const pattern of serverRefuses) assert.doesNotMatch(redacted, pattern);
  assert.doesNotMatch(redacted, /\/Users\/|\/home\//);
  assert.match(redacted, /~\/Projects\/app\/src\/index\.ts/);
  assert.match(redacted, /https:\/\/git\.example\.com\/repo\.git/);
  assert.match(redacted, /page=2/);
});

test('ordinary words, numbers, times and ids stay as they are', () => {
  const text = 'The Reports tab froze after 3 clicks on report 42 at 09:30, run 33333333-3333-4333-8333-333333333333, commit abc1234. See https://hobkin.dev/guide.';

  assert.equal(redact(text, { home: HOME }), text);
});

test('a draft is the contract shape in its order, timed to the second, and hashed over its exact bytes', () => {
  const draft = draftFeedback({ kind: 'bug', message: 'It froze.', id: ID, now: NOW, client: CLIENT });

  assert.deepEqual(Object.keys(JSON.parse(draft.body)), ['schema_version', 'id', 'occurred_at', 'kind', 'message', 'client']);
  assert.deepEqual(JSON.parse(draft.body), {
    schema_version: 1, id: ID, occurred_at: '2026-11-03T12:34:56Z', kind: 'bug', message: 'It froze.', client: CLIENT,
  });
  assert.equal(draft.body, JSON.stringify(JSON.parse(draft.body), null, 2));
  assert.deepEqual({ id: draft.id, kind: draft.kind, sha256: draft.sha256 }, { id: ID, kind: 'bug', sha256: sha256(draft.body) });
});

test('the client facts name this hobkin and machine in the form the server takes', () => {
  const facts = clientFacts();
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  assert.deepEqual(facts, { hobkin_version: version, platform: process.platform, arch: process.arch, node_version: process.versions.node, harness: 'pi' });
  for (const value of Object.values(facts)) assert.match(value, /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/);
});

test('a template report names its template only with recorded provenance', () => {
  const template = provenance => JSON.parse(draftFeedback({ kind: 'template', message: 'Too long.', id: ID, now: NOW, client: CLIENT, template: provenance }).body).template;
  const catalogId = '66666666-6666-4666-8666-666666666666';

  assert.deepEqual(template(undefined), { user_override: true });
  assert.deepEqual(template({ file: 'news-digest.md' }), { user_override: true });
  assert.deepEqual(template({ id: catalogId }), { user_override: true });
  assert.deepEqual(template({ id: catalogId, version: 3, userOverride: false }), { id: catalogId, version: 3, user_override: false });
  assert.deepEqual(template({ id: catalogId, version: 3, userOverride: true }), { id: catalogId, version: 3, user_override: true });
  assert.equal('template' in JSON.parse(draftFeedback({ kind: 'bug', message: 'x', id: ID, now: NOW, client: CLIENT, template: { id: catalogId, version: 3 } }).body), false);
});

test('a crash report carries its class and frames and nothing of the error message', () => {
  const crash = { error_class: 'TypeError', frames: ['hobkin/src/cli/ui.mjs:12:5', 'node:internal/process/task_queues:95:5'] };
  const body = JSON.parse(draftFeedback({ kind: 'crash', message: 'The dashboard stopped on an uncaught error.', id: ID, now: NOW, client: CLIENT, crash }).body);

  assert.deepEqual(body.crash, crash);
  assert.deepEqual(Object.keys(body), ['schema_version', 'id', 'occurred_at', 'kind', 'message', 'client', 'crash']);
});

test('an empty, overlong or unknown report is refused, and control characters and broken text are cleaned first', () => {
  const draft = message => draftFeedback({ kind: 'idea', message, id: ID, now: NOW, client: CLIENT });

  assert.throws(() => draft('   '), /empty/i);
  assert.throws(() => draft('a'.repeat(MAX_MESSAGE_CHARACTERS + 1)), /8,000 characters/);
  assert.equal(JSON.parse(draft('😀'.repeat(MAX_MESSAGE_CHARACTERS)).body).message.length, MAX_MESSAGE_CHARACTERS * 2);
  assert.throws(() => draftFeedback({ kind: 'rant', message: 'x', id: ID, now: NOW, client: CLIENT }), /kind/i);
  assert.equal(JSON.parse(draft('tab\there, bell\u0007, escape\u001b[31m and \ud800 alone').body).message, 'tab\there, bell , escape [31m and � alone');
  assert.ok(Buffer.byteLength(draft('"\\'.repeat(MAX_MESSAGE_CHARACTERS / 2)).body) <= 65536);
});

test('Chat words become a draft, with an optional kind first and home paths taken out', () => {
  const draft = words => JSON.parse(chatDraft(words, { now: NOW, client: CLIENT, home: HOME }).body);

  assert.deepEqual([draft('The list froze').kind, draft('The list froze').message], ['bug', 'The list froze']);
  assert.deepEqual([draft('idea Pin reports').kind, draft('idea Pin reports').message], ['idea', 'Pin reports']);
  assert.deepEqual([draft('Idea: pin reports').kind, draft('Idea: pin reports').message], ['idea', 'pin reports']);
  assert.deepEqual([draft('Bug in the reports tab').kind, draft('Bug in the reports tab').message], ['bug', 'Bug in the reports tab']);
  assert.deepEqual(draft('template The news one is too long').template, { user_override: true });
  assert.equal(draft(`bug ${HOME}/Projects broke`).message, '~/Projects broke');
  assert.notEqual(chatDraft('x', { now: NOW, client: CLIENT }).id, chatDraft('x', { now: NOW, client: CLIENT }).id);
  assert.throws(() => chatDraft('idea', { now: NOW, client: CLIENT }), /empty/i);
});

test('the preview shows the exact bytes and their SHA-256, says redaction is best effort, and does not send by default', () => {
  const draft = draftFeedback({ kind: 'bug', message: 'It froze.', id: ID, now: NOW, client: CLIENT });

  const { question, choices } = feedbackQuestion(draft);

  assert.ok(question.includes(`\n\n${draft.body}\n\n`));
  assert.ok(question.endsWith(`SHA-256 ${draft.sha256}`));
  assert.match(question, /best effort/);
  assert.deepEqual(choices, [{ value: 'keep', label: "Don't send" }, { value: 'send', label: 'Send it' }]);
});
