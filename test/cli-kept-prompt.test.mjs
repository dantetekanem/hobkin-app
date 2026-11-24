import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';
import { HobkinRuntime } from '../src/cli/runtime.mjs';
import { dialog, fakePiRpc } from './helpers/fake-rpc-pi.mjs';

const launcher = { command: ['my-pi-launcher', 'pi'], env: { EXAMPLE_MODE: '1' }, managedExtensions: true };

async function until(condition, message = 'condition') {
  const deadline = Date.now() + 3000;
  while (!await condition()) {
    if (Date.now() > deadline) throw Error(`Timed out waiting for ${message}`);
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-kept-prompt-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main = { cwd: root, model: 'fixture/local', effort: 'medium' };
  config.launcher = launcher;
  atomicJson(join(root, 'config.json'), config);
  const fake = fakePiRpc();
  const runtime = await HobkinRuntime.open(root, config, {
    createMain: options => openPiSession(options, { spawnProcess: fake.spawnProcess, graceMs: 50, createSession: () => { throw Error('Pi started in this process.'); } }),
  });
  t.after(() => Promise.race([runtime.close(), new Promise(resolve => setTimeout(resolve, 2000).unref())]));
  await runtime.connect();
  // What the main agent's Pi asks hobkin for when it writes its system prompt.
  const asked = async op => {
    const id = dialog(fake.children.at(-1), { method: 'input', title: 'hobkin/bridge', placeholder: JSON.stringify({ op }) });
    const answered = () => fake.received.filter(record => record.type === 'extension_ui_response' && record.id === id);
    await until(() => answered().length, `the answer to ${op}`);
    return JSON.parse(answered()[0].value).result;
  };
  const remember = items => writeFileSync(join(root, 'memory.md'), items.map(item => `- ${item}\n`).join(''), { mode: 0o600 });
  return { root, fake, runtime, asked, remember };
}

test("the main agent's prompt keeps its memory as first written, and what is new waits as a note for the next message", { timeout: 10000 }, async t => {
  const h = await fixture(t);
  h.remember(['Likes short answers']);
  assert.deepEqual(await h.asked('memory'), ['Likes short answers']);
  assert.equal(h.runtime.main.promptNews(), null);

  h.remember(['Likes short answers', 'Ships on Fridays']);
  assert.deepEqual(await h.asked('memory'), ['Likes short answers'], 'the prompt does not change between turns');
  const news = h.runtime.main.promptNews();
  assert.match(news.text, /^<hobkin-since>\nMemory now also holds:\n- Ships on Fridays\n<\/hobkin-since>\n\n$/);
  // The same hash, turn after turn, is what keeps the conversation cached.
  const before = h.runtime.main.promptParts.memory;
  await h.asked('memory');
  assert.equal(h.runtime.main.promptParts.memory, before);
  news.told();
  assert.equal(h.runtime.main.promptNews(), null);
});

test('a memory added mid-conversation reaches the main agent as a note and the prompt stays as written', { timeout: 10000 }, async t => {
  const { addMemory, changeMemory, forgetMemory } = await import('../src/cli/memories.mjs');
  const h = await fixture(t);
  assert.equal(await h.asked('memories'), '', 'with no memories the prompt has no index');
  const as = { by: { kind: 'user' }, source: { kind: 'window' } };
  addMemory(h.root, { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon' }, as);
  addMemory(h.root, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true }, as);
  h.runtime.main.keptPrompt.renew();
  const written = await h.asked('memories');
  assert.match(written, /^## What hobkin remembers\n[\s\S]*- lives-in-lisbon: Lives in Lisbon/);
  assert.match(written, /- partner-name: Partner is called Ana \(private\)/, 'the main chat reads private memories');
  assert.match(written, /hobkin_recall/);
  assert.equal(h.runtime.main.promptNews(), null);
  const before = h.runtime.main.promptParts.memories;

  addMemory(h.root, { name: 'reply-short', kind: 'preference', description: 'Replies under 100 words' }, as);
  changeMemory(h.root, 'lives-in-lisbon', { description: 'Lives in Lisbon since 2025' }, as);
  forgetMemory(h.root, 'partner-name', as);
  assert.equal(await h.asked('memories'), written, 'the prompt does not change between turns');
  assert.equal(h.runtime.main.promptParts.memories, before);
  const news = h.runtime.main.promptNews();
  assert.match(news.text, /^<hobkin-since>\nMemories added or changed since:\n- lives-in-lisbon: Lives in Lisbon since 2025\n- reply-short: Replies under 100 words\nMemories gone from your index:\n- partner-name\n<\/hobkin-since>\n\n$/);
  news.told();
  assert.equal(h.runtime.main.promptNews(), null);
});

test('a compaction writes the prompt again, with everything in it', { timeout: 10000 }, async t => {
  const h = await fixture(t);
  h.remember(['Likes short answers']);
  await h.asked('memory');
  const before = h.runtime.main.promptParts.memory;
  h.remember(['Ships on Fridays']);
  const child = h.fake.children[0];
  child.emit_({ type: 'compaction_start', reason: 'threshold' });
  child.emit_({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false });
  await until(async () => (await h.asked('memory'))[0] === 'Ships on Fridays', 'the prompt to be written again');
  assert.notEqual(h.runtime.main.promptParts.memory, before);
  assert.equal(h.runtime.main.promptNews(), null);
});

test('a message carries the note ahead of the words, the chat shows only the words, and the note counts as told once the message was taken', { timeout: 10000 }, async t => {
  const { HobkinApplication } = await import('../src/cli/application.mjs');
  const { fakePi } = await import('./helpers/pi-session.mjs');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-kept-note-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, intervalMs: 60000 });
  t.after(() => app.close());
  const note = '<hobkin-since>\nSince your instructions were written, the user decided:\n- 2026-11-14 12:00: They merged "Fix the sync".\n</hobkin-since>\n\n';
  let told = 0;
  app.runtime.main.promptNews = () => (told ? null : { text: note, told: () => { told++; } });
  const wordsOf = message => (typeof message.content === 'string' ? message.content : message.content.find(part => part.type === 'text').text);
  const lastSent = () => wordsOf(app.runtime.messages().findLast(message => message.role === 'user'));

  // A message hobkin does not take leaves the note for the next one.
  const send = app.runtime.send.bind(app.runtime);
  app.runtime.send = async () => { throw Error('Not admitted.'); };
  await assert.rejects(app.send('lost'), /Not admitted/);
  assert.equal(told, 0);
  app.runtime.send = send;

  await app.send('lets finish this');
  await app.runtime.idle();
  assert.ok(lastSent().endsWith(`${note}lets finish this`), lastSent());
  assert.equal(told, 1);
  const shown = (await app.refresh()).messages.findLast(message => message.role === 'user');
  assert.equal(shown.content, 'lets finish this');

  await app.send('and this');
  await app.runtime.idle();
  assert.equal(lastSent().includes('<hobkin-since>'), false);
});
