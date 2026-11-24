import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addMemory, changeMemory, forgetMemory, memoriesStamp, memoryIndex, readMemories, recallMemories, restoreMemory, undoMemoryChange,
} from '../src/cli/memories.mjs';

const NOW = Date.parse('2026-11-23T14:00:00Z');
const DAY = 86400000;
const MAIN = { by: { kind: 'main' }, source: { kind: 'chat', said: 'I live in Lisbon, look up the Portuguese one' }, now: NOW };
const USER = { by: { kind: 'user' }, source: { kind: 'window' }, now: NOW };

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memories-')));
  t.after(() => {
    try {
      chmodSync(join(root, 'memories'), 0o700);
    } catch {}
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

const lisbon = {
  name: 'lives-in-lisbon',
  kind: 'user',
  description: 'Lives in Lisbon since 2025; use Portuguese sites, prices and rules first',
  text: 'The user lives in Lisbon. For anything that depends on place, look up the Portuguese version first.\n\nSee [[car-insurance-renewal]].',
};
const insurance = { name: 'car-insurance-renewal', kind: 'date', description: 'Car insurance renews every March 3; bring it up two weeks before', text: 'Renews every year on March 3.' };
const names = list => list.map(memory => memory.name);

test('a home with no memories folder reads as none, makes no folder, and an index of none is empty', t => {
  const root = home(t);
  assert.deepEqual(readMemories(root), { memories: [], unreadable: [] });
  assert.equal(memoryIndex(root, { private: true, maxBytes: 8192, now: NOW }), '');
  assert.deepEqual(recallMemories(root, { words: 'lisbon' }, { now: NOW }), []);
  assert.equal(existsSync(join(root, 'memories')), false);
});

test('a memory is one file with its kind, description, text, who added it and when, and where it came from', t => {
  const root = home(t);
  const { memory, change } = addMemory(root, lisbon, MAIN);
  const file = join(root, 'memories', 'lives-in-lisbon.md');
  assert.equal(lstatSync(join(root, 'memories')).mode & 0o777, 0o700);
  assert.equal(lstatSync(file).mode & 0o777, 0o600);
  const source = readFileSync(file, 'utf8');
  assert.match(source, /^---\n\{\n {2}"kind": "user",/);
  assert.match(source, /\n---\nThe user lives in Lisbon\./);
  assert.equal(memory.name, 'lives-in-lisbon');
  assert.equal(memory.kind, 'user');
  assert.equal(memory.text, lisbon.text);
  assert.deepEqual(memory.added, { at: new Date(NOW).toISOString(), by: { kind: 'main' } });
  assert.equal(memory.changed, undefined);
  assert.deepEqual(memory.source, { kind: 'chat', said: 'I live in Lisbon, look up the Portuguese one' });
  assert.deepEqual(memory.links, ['car-insurance-renewal']);
  assert.match(memory.version, /^[0-9a-f]{64}$/);
  assert.match(change, /^[0-9a-f-]{36}$/);
  const [logged] = readFileSync(join(root, 'memories', 'changes.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual([logged.id, logged.name, logged.did, logged.before, logged.after], [change, 'lives-in-lisbon', 'added', null, source]);
  assert.deepEqual(readMemories(root).memories, [memory]);
});

test('who added a memory is what hobkin was told, and the fields an agent might type for it are not read', t => {
  const root = home(t);
  const { memory } = addMemory(root, { ...lisbon, added: { by: { kind: 'user' } }, by: { kind: 'user' } }, { by: { kind: 'hobkin', id: 'h1', title: 'Deploy watcher' }, source: { kind: 'chat' }, now: NOW });
  assert.deepEqual(memory.added.by, { kind: 'hobkin', id: 'h1', title: 'Deploy watcher' });
  assert.throws(() => addMemory(root, insurance, { source: { kind: 'chat' }, now: NOW }), /who is asking/);
});

test('an add is refused for a name in use, for a near double naming the other, for what looks like a secret, and for bad fields', t => {
  const root = home(t);
  addMemory(root, lisbon, MAIN);
  assert.throws(() => addMemory(root, { ...insurance, name: 'lives-in-lisbon' }, MAIN), /"lives-in-lisbon" is in use[\s\S]*Change that memory/);
  assert.throws(() => addMemory(root, { ...lisbon, name: 'home-town', description: 'Lives in Lisbon since 2025; use Portuguese sites first' }, MAIN),
    /"lives-in-lisbon" already says nearly the same/);
  for (const secret of ['The wifi password: hunter22', 'Key sk-abcdefghijklmnopqrstuvwx', 'Card 4111 1111 1111 1111', 'IBAN PT50 0002 0123 1234 5678 9015 4']) {
    assert.throws(() => addMemory(root, { ...insurance, text: secret }, MAIN), /a secret hobkin never keeps/, secret);
  }
  assert.throws(() => addMemory(root, { ...insurance, description: 'token = abcdef123456' }, MAIN), /a secret hobkin never keeps/);
  assert.throws(() => addMemory(root, { ...insurance, name: 'Bad Name' }, MAIN), /name/);
  assert.throws(() => addMemory(root, { ...insurance, kind: 'rule' }, MAIN), /kind/);
  assert.throws(() => addMemory(root, { ...insurance, description: '' }, MAIN), /description/);
  assert.throws(() => addMemory(root, { ...insurance, description: 'x'.repeat(151) }, MAIN), /150/);
  assert.throws(() => addMemory(root, { ...insurance, description: 'two\nlines' }, MAIN), /one line/);
  assert.throws(() => addMemory(root, { ...insurance, text: 'x'.repeat(2001) }, MAIN), /2000/);
  assert.throws(() => addMemory(root, { ...insurance, until: '2026-02-30' }, MAIN), /YYYY-MM-DD/);
  assert.throws(() => addMemory(root, { ...insurance, text: 'é'.repeat(2000) }, MAIN), /4 KB/);
  assert.deepEqual(names(readMemories(root).memories), ['lives-in-lisbon'], 'nothing refused was kept');
  assert.equal(readFileSync(join(root, 'memories', 'changes.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('the user\'s own words are kept up to 300 characters', t => {
  const root = home(t);
  const { memory } = addMemory(root, lisbon, { ...MAIN, source: { kind: 'remember', said: 'w'.repeat(400), from: 'Claude Code' } });
  assert.equal(memory.source.said.length, 300);
  assert.equal(memory.source.from, 'Claude Code');
});

test('past 300 memories an add is refused', t => {
  const root = home(t);
  mkdirSync(join(root, 'memories'), { recursive: true });
  for (let index = 0; index < 300; index += 1) {
    writeFileSync(join(root, 'memories', `fact-${index}.md`), `---\n{"kind":"user","description":"Fact number ${index} zq${index}"}\n---\n`);
  }
  assert.throws(() => addMemory(root, insurance, MAIN), /at most 300/);
});

test('a change keeps who added it, stamps who changed it and logs before and after, and a stale version is refused', t => {
  const root = home(t);
  const added = addMemory(root, lisbon, MAIN).memory;
  const before = readFileSync(join(root, 'memories', 'lives-in-lisbon.md'), 'utf8');
  const later = NOW + DAY;
  const { memory, change } = changeMemory(root, 'lives-in-lisbon', { description: 'Lives in Lisbon; Portuguese sites first', until: '2027-01-01' }, { by: { kind: 'user' }, now: later, version: added.version });
  assert.deepEqual(memory.added, added.added);
  assert.deepEqual(memory.changed, { at: new Date(later).toISOString(), by: { kind: 'user' } });
  assert.equal(memory.text, lisbon.text, 'what was not given stays');
  assert.equal(memory.until, '2027-01-01');
  const logged = readFileSync(join(root, 'memories', 'changes.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).at(-1);
  assert.deepEqual([logged.id, logged.did, logged.before], [change, 'changed', before]);
  assert.throws(() => changeMemory(root, 'lives-in-lisbon', { text: 'Old draft.' }, { by: { kind: 'user' }, now: later, version: added.version }), /changed since you opened it/);
  assert.throws(() => changeMemory(root, 'no-such-one', { text: 'x' }, { by: { kind: 'main' }, now: later }), /No memory is called "no-such-one"/);
  assert.equal(changeMemory(root, 'lives-in-lisbon', { until: null }, { by: { kind: 'main' }, now: later }).memory.until, undefined, 'until can be cleared');
});

test('a private memory is kept apart, reaches only an index and a recall that allow it, and moves when made shared', t => {
  const root = home(t);
  addMemory(root, lisbon, MAIN);
  const partner = addMemory(root, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true }, MAIN).memory;
  assert.equal(existsSync(join(root, 'memories', 'private', 'partner-name.md')), true);
  assert.equal(existsSync(join(root, 'memories', 'partner-name.md')), false);
  assert.equal(lstatSync(join(root, 'memories', 'private')).mode & 0o777, 0o700);
  assert.equal(partner.private, true);

  const shared = memoryIndex(root, { private: false, maxBytes: 4096, now: NOW });
  assert.doesNotMatch(shared, /partner|Ana/);
  assert.match(memoryIndex(root, { private: true, maxBytes: 8192, now: NOW }), /- partner-name: Partner is called Ana \(private\)/);
  assert.deepEqual(names(readMemories(root, { private: false }).memories), ['lives-in-lisbon']);
  assert.deepEqual(recallMemories(root, { words: 'ana' }, { private: false, now: NOW }), []);
  assert.deepEqual(recallMemories(root, { name: 'partner-name' }, { private: false, now: NOW }), []);
  assert.deepEqual(recallMemories(root, { kind: 'user' }, { private: false, now: NOW }).map(memory => memory.name), ['lives-in-lisbon']);
  assert.deepEqual(names(recallMemories(root, { name: 'partner-name' }, { private: true, now: NOW })), ['partner-name']);
  assert.throws(() => addMemory(root, { ...insurance, name: 'partner-name' }, MAIN), /is in use/, 'a name is one across both folders');

  changeMemory(root, 'partner-name', { private: false }, { by: { kind: 'main' }, now: NOW });
  assert.equal(existsSync(join(root, 'memories', 'private', 'partner-name.md')), false);
  assert.match(memoryIndex(root, { private: false, maxBytes: 4096, now: NOW }), /partner-name/);
});

test('forget moves a memory aside, restore brings it back within 30 days, and after that it is gone', t => {
  const root = home(t);
  addMemory(root, lisbon, MAIN);
  const { change } = forgetMemory(root, 'lives-in-lisbon', { by: { kind: 'main' }, now: NOW });
  assert.match(change, /^[0-9a-f-]{36}$/);
  assert.deepEqual(readMemories(root).memories, []);
  assert.equal(readdirSync(join(root, 'memories', 'forgotten')).length, 1);
  assert.throws(() => forgetMemory(root, 'lives-in-lisbon', { by: { kind: 'main' }, now: NOW }), /No memory is called/);

  const restored = restoreMemory(root, 'lives-in-lisbon', { by: { kind: 'main' }, now: NOW + DAY });
  assert.equal(restored.memory.description, lisbon.description);
  assert.deepEqual(names(readMemories(root).memories), ['lives-in-lisbon']);

  forgetMemory(root, 'lives-in-lisbon', { by: { kind: 'main' }, now: NOW + DAY });
  assert.throws(() => restoreMemory(root, 'lives-in-lisbon', { by: { kind: 'main' }, now: NOW + 32 * DAY }), /nothing forgotten in the last 30 days/i);
  addMemory(root, insurance, { ...MAIN, now: NOW + 32 * DAY });
  assert.equal(readdirSync(join(root, 'memories', 'forgotten')).length, 0, 'what is older than 30 days is cleared on the next write');
});

test('every change is undone each way, and an undo is refused once the memory changed since', t => {
  const root = home(t);
  const as = { by: { kind: 'user' }, now: NOW + 1000 };
  // Undo of an add forgets it.
  const added = addMemory(root, lisbon, MAIN);
  const undoneAdd = undoMemoryChange(root, added.change, as);
  assert.deepEqual([undoneAdd.did, undoneAdd.name], ['forgot', 'lives-in-lisbon']);
  assert.match(undoneAdd.change, /^[0-9a-f-]{36}$/, 'an undo is a change of its own');
  assert.deepEqual(readMemories(root).memories, []);
  // And that undo can be undone in turn.
  assert.equal(undoMemoryChange(root, undoneAdd.change, as).did, 'restored');
  assert.deepEqual(names(readMemories(root).memories), ['lives-in-lisbon']);
  // Undo of a change puts the words back.
  const changed = changeMemory(root, 'lives-in-lisbon', { text: 'Lives in Porto now.' }, { by: { kind: 'main' }, now: NOW });
  assert.equal(undoMemoryChange(root, changed.change, as).did, 'changed');
  assert.equal(readMemories(root).memories[0].text, lisbon.text);
  // Undo of a forget restores it.
  const forgot = forgetMemory(root, 'lives-in-lisbon', { by: { kind: 'main' }, now: NOW });
  assert.equal(undoMemoryChange(root, forgot.change, as).did, 'restored');
  assert.deepEqual(names(readMemories(root).memories), ['lives-in-lisbon']);

  // Refused once it changed since, and an undo is not done twice.
  const second = changeMemory(root, 'lives-in-lisbon', { text: 'Lives in Porto now.' }, { by: { kind: 'main' }, now: NOW });
  changeMemory(root, 'lives-in-lisbon', { text: 'Lives in Braga now.' }, { by: { kind: 'user' }, now: NOW });
  assert.throws(() => undoMemoryChange(root, second.change, as), /changed since; edit it instead/);
  const third = changeMemory(root, 'lives-in-lisbon', { text: 'Lives in Faro now.' }, { by: { kind: 'main' }, now: NOW });
  undoMemoryChange(root, third.change, as);
  assert.throws(() => undoMemoryChange(root, third.change, as), /changed since; edit it instead/);
  assert.throws(() => undoMemoryChange(root, 'no-such-change', as), /hobkin has no such change/);
  const gone = forgetMemory(root, 'lives-in-lisbon', { by: { kind: 'main' }, now: NOW });
  addMemory(root, { ...lisbon, description: 'A new home in Lisbon, written again by hand' }, MAIN);
  assert.throws(() => undoMemoryChange(root, gone.change, as), /"lives-in-lisbon" is in use/);
});

test('the index lists by kind in order, newest change first, leaves out a past one, and over its cap says how many more', t => {
  const root = home(t);
  addMemory(root, { name: 'old-project', kind: 'project', description: 'Moving house in January' }, { ...MAIN, now: NOW - 3 * DAY });
  addMemory(root, insurance, { ...MAIN, now: NOW - 2 * DAY });
  addMemory(root, { name: 'reply-short', kind: 'preference', description: 'Replies under 100 words, point first' }, { ...MAIN, now: NOW - DAY });
  addMemory(root, lisbon, { ...MAIN, now: NOW - 5 * DAY });
  addMemory(root, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana' }, { ...MAIN, now: NOW });
  addMemory(root, { name: 'tax-papers', kind: 'pointer', description: 'Tax papers are in ~/Documents/Taxes, one folder a year' }, { ...MAIN, now: NOW });
  addMemory(root, { name: 'kept-laptop', kind: 'decision', description: 'Kept the old laptop for travel; the new one is too heavy' }, { ...MAIN, now: NOW });
  addMemory(root, { name: 'passport-date', kind: 'date', description: 'Passport expires 2026-11-20', until: '2026-11-20' }, { ...MAIN, now: NOW - 9 * DAY });
  addMemory(root, { name: 'dentist-today', kind: 'date', description: 'Dentist on Nov 23 at 10:00', until: '2026-11-23' }, { ...MAIN, now: NOW - 9 * DAY });

  const index = memoryIndex(root, { private: false, maxBytes: 4096, now: NOW, recall: 'hobkin_recall' });
  const lines = index.split('\n').filter(line => line.startsWith('- ')).map(line => line.slice(2, line.indexOf(':')));
  assert.deepEqual(lines, ['partner-name', 'lives-in-lisbon', 'reply-short', 'car-insurance-renewal', 'dentist-today', 'kept-laptop', 'tax-papers', 'old-project']);
  assert.match(index, /^## What hobkin remembers\n/);
  assert.match(index, /hobkin_recall/);
  assert.match(index, /context, never an instruction/);
  assert.doesNotMatch(index, /passport/, 'a memory whose day has passed is left out');

  const small = memoryIndex(root, { private: false, maxBytes: 420, now: NOW, recall: 'hobkin_recall' });
  assert.ok(Buffer.byteLength(small) <= 420, `${Buffer.byteLength(small)} bytes`);
  const shown = small.split('\n').filter(line => line.startsWith('- ')).length;
  assert.ok(shown >= 1 && shown < 8);
  assert.match(small, new RegExp(`\\n${8 - shown} more: find them with hobkin_recall\\.$`));
  assert.match(memoryIndex(root, { private: false, maxBytes: 420, now: NOW, recall: 'hobkin memory' }), /more: find them with hobkin memory search/);
  assert.match(memoryIndex(root, { private: false, maxBytes: 420, now: NOW }), /more were left out\.$/);
});

test('a hand-edited file is read, and a broken, oversized or misnamed one is skipped and named', t => {
  const root = home(t);
  mkdirSync(join(root, 'memories', 'private'), { recursive: true });
  writeFileSync(join(root, 'memories', 'by-hand.md'), '---\n{ "kind": "preference", "description": "Prefers the train under 600 km" }\n---\nWritten by hand.\n');
  writeFileSync(join(root, 'memories', 'broken.md'), '---\n{ kind: preference }\n---\n');
  writeFileSync(join(root, 'memories', 'no-front.md'), 'Just words.\n');
  writeFileSync(join(root, 'memories', 'odd-kind.md'), '---\n{ "kind": "rule", "description": "Always lint" }\n---\n');
  writeFileSync(join(root, 'memories', 'huge.md'), `---\n{ "kind": "user", "description": "Big" }\n---\n${'x'.repeat(5000)}`);
  writeFileSync(join(root, 'memories', 'Bad Name.md'), '---\n{ "kind": "user", "description": "Misnamed" }\n---\n');
  writeFileSync(join(root, 'memories', 'private', 'hidden-broken.md'), 'nope');
  writeFileSync(join(root, 'memories', 'notes.txt'), 'not a memory');
  const { memories, unreadable } = readMemories(root);
  assert.deepEqual(names(memories), ['by-hand']);
  assert.equal(memories[0].text, 'Written by hand.');
  assert.equal(memories[0].added, undefined);
  assert.deepEqual([...unreadable].sort(), ['Bad Name', 'broken', 'huge', 'no-front', 'odd-kind', 'private/hidden-broken']);
  assert.deepEqual(readMemories(root, { private: false }).unreadable.includes('private/hidden-broken'), false);
  assert.match(memoryIndex(root, { private: false, maxBytes: 4096, now: NOW }), /- by-hand: Prefers the train under 600 km/);
});

test('a memories folder that cannot be read costs the index and nothing else', t => {
  if (process.getuid?.() === 0) return;
  const root = home(t);
  addMemory(root, lisbon, MAIN);
  chmodSync(join(root, 'memories'), 0o000);
  assert.equal(memoryIndex(root, { private: true, maxBytes: 8192, now: NOW }), '');
  assert.deepEqual(recallMemories(root, { words: 'lisbon' }, { now: NOW }), []);
});

test('recall finds by name, by kind and by words, every word matching, the name counting most, and says what is past', t => {
  const root = home(t);
  addMemory(root, lisbon, { ...MAIN, now: NOW - DAY });
  addMemory(root, insurance, MAIN);
  addMemory(root, { name: 'lisbon-dentist', kind: 'pointer', description: 'The dentist the user sees', text: 'A clinic near the river.' }, { ...MAIN, now: NOW - 2 * DAY });
  addMemory(root, { name: 'old-trip', kind: 'date', description: 'Trip to Porto', until: '2026-10-01', text: 'Went by train from Lisbon.' }, { ...MAIN, now: NOW - 3 * DAY });
  addMemory(root, { name: 'tram-pass', kind: 'pointer', description: 'Monthly tram pass for Lisbon' }, MAIN);

  assert.deepEqual(names(recallMemories(root, { name: 'car-insurance-renewal' }, { now: NOW })), ['car-insurance-renewal']);
  assert.deepEqual(names(recallMemories(root, { kind: 'date' }, { now: NOW })), ['car-insurance-renewal', 'old-trip']);
  assert.deepEqual(names(recallMemories(root, { words: 'Lisbon' }, { now: NOW })), ['lives-in-lisbon', 'lisbon-dentist', 'tram-pass', 'old-trip'],
    'a match in the name counts most, then the description, then the text, and the newest change breaks a tie');
  assert.deepEqual(names(recallMemories(root, { words: 'lisbon river' }, { now: NOW })), ['lisbon-dentist'], 'every word must match');
  assert.deepEqual(names(recallMemories(root, { words: 'lisbon', kind: 'date' }, { now: NOW })), ['old-trip']);
  assert.deepEqual(names(recallMemories(root, { words: 'lisbon', limit: 1 }, { now: NOW })), ['lives-in-lisbon']);
  assert.equal(recallMemories(root, { name: 'old-trip' }, { now: NOW })[0].past, true);
  assert.equal(recallMemories(root, { name: 'lives-in-lisbon' }, { now: NOW })[0].past, undefined);
  assert.deepEqual(recallMemories(root, { words: 'nothing-like-it' }, { now: NOW }), []);
});

test('the stamp moves when a memory or the right-now list changes, and stays while nothing does', t => {
  const root = home(t);
  const empty = memoriesStamp(root);
  assert.equal(memoriesStamp(root), empty);
  addMemory(root, lisbon, MAIN);
  const one = memoriesStamp(root);
  assert.notEqual(one, empty);
  assert.equal(memoriesStamp(root), one);
  changeMemory(root, 'lives-in-lisbon', { text: 'Lives in Porto now.' }, { by: { kind: 'main' }, now: NOW });
  const two = memoriesStamp(root);
  assert.notEqual(two, one);
  writeFileSync(join(root, 'memory.md'), '- Reply to the landlord by Nov 28\n');
  assert.notEqual(memoriesStamp(root), two);
});

test('what names a secret and gives it is refused, saying what kind it looked like and that a memory may say where it is kept', t => {
  const root = home(t);
  const refused = {
    'My password is hunter22': 'a password',
    'The wifi password is blue-otter-42': 'a password',
    'The router passphrase = correct horse': 'a password',
    'Bank PIN is 4821': 'a PIN',
    'The card security code: 737': 'a security code',
    'The building door code is 1234#': 'a door code',
    'Gate code is 4455': 'a door code',
    'Recovery codes: 3f9a-7c2e 81bd-44ac': 'recovery codes',
    'Seed phrase: apple river stone cloud lamp': 'a seed phrase',
    'SIN 046 454 286': 'a social insurance number',
    'Her number is 046 454 286': 'a social insurance number',
    'SSN 123-45-6789': 'a social security number',
    'Passport is X1234567, expires 2030': 'a passport, licence or health card number',
    "Driver's licence D1234-56789-01234": 'a passport, licence or health card number',
    'Health card 1234-567-890': 'a passport, licence or health card number',
    'Chequing account 12345678': 'an account number',
    'Card 4111 1111 1111 1111': 'a card number',
  };
  for (const [words, kind] of Object.entries(refused)) {
    assert.throws(() => addMemory(root, { ...insurance, text: words }, MAIN), error => {
      assert.match(error.message, new RegExp(`it looks like ${kind}, a secret hobkin never keeps`), words);
      assert.match(error.message, /can say that it exists and where it is kept/);
      return true;
    }, words);
  }
  const kept = [
    'The wifi password is in the password manager',
    'The recovery codes are in the safe, in the blue folder',
    'The PIN is on the back of the bank letter',
    'Passport expires 2030-03-10',
    'Order 4111111111111111 shipped on Monday',
    'Flight confirmation 4532015112830366',
    'Call the landlord at 416-555-0199',
    'The password is 12 characters long',
  ];
  kept.forEach((words, index) => {
    addMemory(root, { name: `kept-${index}`, kind: 'pointer', description: `Fact ${index} zq${index} wv${index}`, text: words }, MAIN);
  });
  assert.equal(readMemories(root).memories.length, kept.length, 'a fact about a secret, a date, an order or a phone number is kept');
});

test('a secret saved before it was refused leaves changes.jsonl and the inbox at the first refusal, and forget keeps no copy of it', t => {
  const root = home(t);
  addMemory(root, lisbon, MAIN);
  // As a memory let through before: by hand, with a line in the log and one in the inbox.
  const leaked = '---\n{ "kind": "pointer", "description": "Home wifi" }\n---\nThe wifi password is blue-otter-42\n';
  writeFileSync(join(root, 'memories', 'home-wifi.md'), leaked);
  writeFileSync(join(root, 'memories', 'changes.jsonl'), `${readFileSync(join(root, 'memories', 'changes.jsonl'), 'utf8')}${JSON.stringify({ id: 'c0ffee00-0000-4000-8000-000000000000', at: new Date(NOW).toISOString(), by: { kind: 'main' }, name: 'home-wifi', did: 'added', before: null, after: leaked })}\n`);
  mkdirSync(join(root, 'runtime'), { recursive: true });
  writeFileSync(join(root, 'runtime', 'inbox.jsonl'), `${JSON.stringify({ id: 'e1', kind: 'memory', text: 'The wifi password is blue-otter-42', from: 'Claude Code', at: new Date(NOW).toISOString() })}\n`);

  assert.throws(() => changeMemory(root, 'home-wifi', { description: 'Home wifi network' }, { by: { kind: 'main' }, now: NOW }), /a secret hobkin never keeps/);
  assert.doesNotMatch(readFileSync(join(root, 'memories', 'changes.jsonl'), 'utf8'), /blue-otter-42/);
  assert.doesNotMatch(readFileSync(join(root, 'runtime', 'inbox.jsonl'), 'utf8'), /blue-otter-42/);
  assert.match(readFileSync(join(root, 'memories', 'changes.jsonl'), 'utf8'), /lives-in-lisbon/, 'the rest of the log stays');

  const { change } = forgetMemory(root, 'home-wifi', { by: { kind: 'user' }, now: NOW });
  assert.equal(existsSync(join(root, 'memories', 'home-wifi.md')), false);
  const forgotten = join(root, 'memories', 'forgotten');
  assert.equal(existsSync(forgotten) ? readdirSync(forgotten).length : 0, 0, 'no copy waits in forgotten/');
  assert.doesNotMatch(readFileSync(join(root, 'memories', 'changes.jsonl'), 'utf8'), /blue-otter-42/);
  assert.throws(() => undoMemoryChange(root, change, { by: { kind: 'user' }, now: NOW }), /looked like a secret, so hobkin kept no copy/);
});

test('eight processes adding the same name at once save it once, the other seven are refused as a name in use, and the one add can be undone', async t => {
  const { spawn } = await import('node:child_process');
  const root = home(t);
  const store = new URL('../src/cli/memories.mjs', import.meta.url).href;
  const at = Date.now() + 400;
  const adding = index => new Promise((resolve, reject) => {
    const program = `
      const { addMemory } = await import(${JSON.stringify(store)});
      while (Date.now() < ${at}) {}
      try {
        addMemory(${JSON.stringify(root)}, { name: 'race-name', kind: 'user', description: 'Written by process ${index} zq${index}' }, { by: { kind: 'user' } });
        process.stdout.write('saved');
      } catch (error) {
        process.stdout.write(error.refused ? 'refused: ' + error.message : 'failed: ' + error.message);
      }`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', program]);
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('error', reject);
    child.on('close', () => resolve(out));
  });
  const answers = await Promise.all(Array.from({ length: 8 }, (_, index) => adding(index)));
  assert.equal(answers.filter(answer => answer === 'saved').length, 1, answers.join('\n'));
  assert.ok(answers.filter(answer => answer !== 'saved').every(answer => /^refused: Nothing was saved: "race-name" is in use/.test(answer)), answers.join('\n'));
  const added = readFileSync(join(root, 'memories', 'changes.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(line => line.did === 'added');
  assert.equal(added.length, 1);
  assert.equal(undoMemoryChange(root, added[0].id, { by: { kind: 'user' } }).did, 'forgot');
});

test('a file that is not a memory can still be forgotten, as the window does with a broken one', t => {
  const root = home(t);
  mkdirSync(join(root, 'memories'), { recursive: true });
  writeFileSync(join(root, 'memories', 'huge.md'), 'x'.repeat(5000));
  forgetMemory(root, 'huge', { by: { kind: 'user' }, now: NOW });
  assert.equal(existsSync(join(root, 'memories', 'huge.md')), false);
});
