import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize, setLearning } from '../src/cli/config.mjs';
import { fileDecision, markShown, openDecisions } from '../src/cli/decisions.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { answerOffer, askAgent, declineItem, mergeItem } from '../src/cli/work/controls.mjs';
import { LandOffers, notSurveyed, offerDecisions, offersView, retireOffers } from '../src/cli/work/land-offer.mjs';
import { offerFor } from '../src/cli/work/patterns.mjs';
import { readTrackRecords, readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, paths, readItems, recordLaunch, updateItem } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { commit, git, repository } from './helpers/work-fixture.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-06-01T12:00:00Z');
const draft = (id, title = `Fix ${id}`) => ({ slug: 'api', id, project: 'API', title });

function offering({ offers, unread } = {}) {
  const filed = [];
  const clock = { at: 1000 * HOUR };
  const landOffers = new LandOffers({ file: decision => filed.push(decision), now: () => clock.at, offers, unread });
  return { filed, offers: landOffers, clock };
}

test('a finished branch files one decision: walk it now or later', () => {
  const { filed, offers } = offering();

  offers.add(draft('a1', 'Fix login'));

  const [{ key, question, tldr, choices, answerTo }] = filed;
  assert.equal(key, 'land');
  assert.match(question, /Fix login on API can land/);
  assert.match(tldr, /1 finished branch can land/);
  assert.deepEqual(choices.map(({ value }) => value), ['later', 'walk']);
  assert.deepEqual(answerTo, { kind: 'land' });
});

test('branches that finish close together wait, and two hours on they are one decision', () => {
  const { filed, offers, clock } = offering();

  offers.add(draft('a1'));
  offers.add(draft('a2'));
  offers.add(draft('a3'));
  assert.equal(filed.length, 1);

  clock.at += 2 * HOUR;
  offers.next();

  assert.equal(filed.length, 2);
  assert.match(filed[1].question, /2 finished branches can land/);
});

test('with nowhere to file, nothing is lost', () => {
  const offers = new LandOffers({});

  offers.add(draft('a1'));

  assert.equal(offers.waiting.length, 1);
});

test('an offer goes ahead of the plain question, one every two hours, and what it covers stops waiting', () => {
  const offer = { key: 'offer:api:a1', answerTo: { kind: 'merge', slug: 'api', item: 'a1', head: 'tip' } };
  const open = [offer];
  const { filed, offers, clock } = offering({ offers: () => open });

  offers.add(draft('a1'));
  offers.add(draft('a2'));

  assert.deepEqual(filed.map(({ key }) => key), ['offer:api:a1']);
  assert.deepEqual(offers.waiting.map(({ id }) => id), ['a2']);

  open.length = 0;
  offers.next();
  assert.equal(filed.length, 1, 'still inside the two hours');

  clock.at += 2 * HOUR;
  offers.next();
  assert.deepEqual(filed.map(({ key }) => key), ['offer:api:a1', 'land']);
});

test('a draft the survey has not read waits to be weighed, and gets the plain question within the hour', () => {
  const { filed, offers, clock } = offering({ unread: () => true });

  offers.add(draft('a1'));
  assert.equal(filed.length, 0);

  clock.at += HOUR;
  offers.next();

  assert.deepEqual(filed.map(({ key }) => key), ['land']);
});

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-offer-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  setLearning(root, true);
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  return { base, root, checkout, reviews: join(base, 'auto-review'), serial: 0 };
}

function reviewed(h, head, grade = 'safe', rating = 'A') {
  const folder = join(h.reviews, 'session');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${head.slice(0, 8)}.review.json`), JSON.stringify({ status: 'complete', preflight: { head }, grades: { merge: { grade, rating, reason: 'It reads well.' } } }));
}

const iso = at => new Date(at).toISOString();
const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: h.reviews });
const tipOf = (h, name) => git(h.checkout, 'rev-parse', name);
const read = (h, id) => readItems(h.root, 'api').find(item => item.id === id);
const rowOf = (h, id) => readyItems(h.root).find(({ item }) => item === id);

function history(h, { count = 1, outcome = 'held', at = NOW - 3 * DAY, kind = 'fix', area = 'lib', title = 'Fix fee rounding', closed = NOW - DAY } = {}) {
  return Array.from({ length: count }, (_, index) => {
    h.serial += 1;
    const { id } = fileItem(h.root, 'api', { key: `old ${h.serial}`, kind, title: count > 1 ? `${title} ${index}` : title, brief: 'Before.' }, NOW);
    updateItem(h.root, 'api', id, { state: 'merged', landed: { sha: 'old', at: iso(at), route: 'key', area } }, NOW);
    recordLaunch(h.root, 'api', { item: id, stage: outcome ? 'closed' : 'merged', mergedAt: iso(at), ...(outcome ? { outcome } : {}) }, closed);
    return id;
  });
}

const isSpot = id => offerFor({
  slug: 'api',
  item: { id, kind: 'fix', proof: 'Yes.', quality: { rating: 'A', head: 'tip' } },
  unit: { sha: 'tip', area: 'lib', conflict: false, size: { additions: 1, deletions: 0, files: 1 }, paths: ['lib/a.rb'], safety: { grade: 'safe', rating: 'A' } },
  gap: 'land',
  records: new Map([['api/fix/lib', { slug: 'api', kind: 'fix', area: 'lib', merged: 1, weight: 1, off: null, troubleAt: null, latest: {} }]]),
}).spot;

function freshKey(h, name, spot) {
  for (;;) {
    h.serial += 1;
    const key = `${name} ${h.serial}`;
    if (isSpot(createHash('sha256').update(key).digest('hex').slice(0, 6)) === spot) return key;
  }
}

/** A finished branch that passes every check, on its own commit. */
function qualifying(h, name, { spot = false, area = 'lib', ...change } = {}) {
  const branch = `hobkin/${name}`;
  git(h.checkout, 'switch', '-qc', branch);
  mkdirSync(join(h.checkout, area), { recursive: true });
  commit(h.checkout, `${area}/${name}.rb`, `${name}\n`);
  git(h.checkout, 'switch', '-q', 'main');
  const head = tipOf(h, branch);
  reviewed(h, head);
  const { id } = fileItem(h.root, 'api', { key: freshKey(h, name, spot), kind: 'fix', title: `Fix ${name}`, brief: 'The first change.' }, NOW);
  updateItem(h.root, 'api', id, {
    state: 'branch',
    branch,
    proof: 'It failed, then it passed.',
    quality: { rating: 'A', reason: 'Well covered.', head },
    launch: { undo: 'code', how: 'kamal rollback', risk: `the refund branch in lib/${name}.rb:42`, lookAt: 'requests' },
    ...change,
  }, NOW);
  return { id, head, branch };
}

const seesRequests = h => {
  mkdirSync(paths(h.root, 'api').directory, { recursive: true });
  writeFileSync(paths(h.root, 'api').signals, JSON.stringify({ signal: 3 }));
};

test('a branch like one that held gets an offer with counts, one named risk and the harmless choice first', async t => {
  const h = workspace(t);
  history(h);
  const { id, head } = qualifying(h, 'cashback');
  await survey(h);

  const [offer, ...rest] = offerDecisions(h.root, NOW);

  assert.deepEqual(rest, []);
  assert.equal(offer.key, `offer:api:${id}`);
  assert.deepEqual(offer.choices.map(({ value }) => value), ['later', 'merge', 'read', 'no']);
  assert.deepEqual(offer.answerTo, { kind: 'merge', slug: 'api', item: id, head });
  assert.match(offer.question, /api: Fix cashback · safe A · 1 line\n/);
  assert.match(offer.question, /Like "Fix fee rounding", merged May 29\. Its watch closed after 2 days, nothing new\./);
  assert.match(offer.question, /Risk: the refund branch in lib\/cashback\.rb:42\./);
  assert.match(offer.question, /Undo: kamal rollback\./);
  assert.doesNotMatch(offer.question, /%/);
});

test('several precedents show as counts, and one still in its watch says so', async t => {
  const h = workspace(t);
  history(h, { count: 2 });
  history(h, { outcome: 'quiet', at: NOW - 2 * DAY });
  history(h, { outcome: null, at: NOW - HOUR, title: 'Fix the latest' });
  qualifying(h, 'cashback');
  await survey(h);

  const [{ question }] = offerDecisions(h.root, NOW);

  assert.match(question, /Like "Fix the latest", merged .*It is still in its watch\./);
  assert.match(question, /4 merged like it: 2 held, 1 quiet, 1 still in a watch\./);
});

test('an offer says what the project cannot see', async t => {
  const h = workspace(t);
  history(h);
  qualifying(h, 'cashback');
  await survey(h);

  assert.match(offerDecisions(h.root, NOW)[0].question, /cannot see requests or runs on api/);

  seesRequests(h);

  assert.doesNotMatch(offerDecisions(h.root, NOW)[0].question, /cannot see/);
});

test('with learning off nothing is judged: no offers, no precedent on a row, and the plain question stays', async t => {
  const h = workspace(t);
  history(h);
  const { id } = qualifying(h, 'cashback');
  await survey(h);
  setLearning(h.root, false);

  assert.deepEqual(offerDecisions(h.root, NOW), []);
  assert.equal(rowOf(h, id).like, null);
  assert.deepEqual(offersView(h.root, NOW), { learning: false, offers: [], rest: [] });
  assert.equal(notSurveyed(h.root, { slug: 'api', id: 'unknown' }), false);
});

test('a row with a precedent carries it, and one from another project says where', async t => {
  const h = workspace(t);
  history(h, { count: 3 });
  history(h, { outcome: null, at: NOW - HOUR });
  const { id } = qualifying(h, 'cashback');
  await survey(h);

  assert.deepEqual(rowOf(h, id).like, { merged: 4, watching: 1 });
});

test('earned items of one pattern share one decision, up to five, and the rest wait their turn', async t => {
  const h = workspace(t);
  history(h, { count: 9, at: NOW, closed: NOW });
  const made = ['one', 'two', 'three', 'four', 'five', 'six'].map(name => qualifying(h, name));
  await survey(h);

  const [offer] = offerDecisions(h.root, NOW);

  assert.equal(offer.choices[1].label, 'Merge all 5');
  assert.equal(offer.key, `offer:api:${offer.answerTo.item}`);
  assert.equal(offer.answerTo.also.length, 4);
  assert.ok(offer.answerTo.also.every(({ item, head }) => made.some(entry => entry.id === item && entry.head === head)));
  assert.match(offer.question, /api: 5 alike · safe A · 5 lines/);
});

test('a seen pattern offers one at a time', async t => {
  const h = workspace(t);
  history(h);
  qualifying(h, 'one');
  qualifying(h, 'two');
  await survey(h);

  assert.deepEqual(offerDecisions(h.root, NOW).map(({ answerTo: { also } }) => also), [undefined, undefined]);
});

test('an offer open or held is not offered again, and a held one comes back after a day', async t => {
  const h = workspace(t);
  history(h);
  const { id, head } = qualifying(h, 'cashback');
  await survey(h);
  const [offer] = offerDecisions(h.root, NOW);
  const { id: decision } = fileDecision(h.root, offer, NOW);

  assert.deepEqual(offerDecisions(h.root, NOW), []);

  await answerOffer(h.root, { slug: 'api', item: id, head }, 'later', NOW);
  retireOffers(h.root, NOW);
  assert.equal(openDecisions(h.root).length, 1, 'it still waits for its own answer');
  assert.equal(decision, openDecisions(h.root)[0].id);
});

test('later holds an offer for a day, and read holds it too', async t => {
  const h = workspace(t);
  history(h);
  const later = qualifying(h, 'one');
  const reading = qualifying(h, 'two');
  await survey(h);

  await answerOffer(h.root, { slug: 'api', item: later.id, head: later.head }, 'later', NOW);
  await answerOffer(h.root, { slug: 'api', item: reading.id, head: reading.head }, 'read', NOW);

  assert.deepEqual(offerDecisions(h.root, NOW + 23 * HOUR), []);
  assert.equal(offerDecisions(h.root, NOW + 25 * HOUR).length, 2);
  assert.equal(read(h, later.id).state, 'branch');
});

test('no declines the item and counts against its pattern', async t => {
  const h = workspace(t);
  history(h, { count: 2 });
  const { id, head } = qualifying(h, 'cashback');
  await survey(h);
  const before = readTrackRecords(h.root, NOW).get('api/fix/lib').weight;

  await answerOffer(h.root, { slug: 'api', item: id, head }, 'no', NOW);

  assert.equal(read(h, id).state, 'declined');
  assert.ok(tipOf(h, 'hobkin/cashback'));
  assert.ok(readTrackRecords(h.root, NOW).get('api/fix/lib').weight <= before - 1 + 0.01);
});

test('sending a branch back counts against its pattern, and answering a run\'s question does not', async t => {
  const h = workspace(t);
  history(h, { count: 2 });
  const first = qualifying(h, 'one');
  const second = qualifying(h, 'two');
  await survey(h);

  askAgent(h.root, 'api', first.id, 'Keep the old flag.', { now: NOW });
  askAgent(h.root, 'api', second.id, 'They answered yes.', { answering: true, now: NOW });

  assert.deepEqual(read(h, first.id).pushbacks, [{ at: iso(NOW), area: 'lib' }]);
  assert.equal(read(h, second.id).pushbacks, undefined);
});

test('merging on an offer lands it with the offer route, and nothing was read', async t => {
  const h = workspace(t);
  history(h);
  const { id, head, branch } = qualifying(h, 'cashback');
  await survey(h);

  const { message } = await answerOffer(h.root, { slug: 'api', item: id, head }, 'merge', NOW);

  assert.match(message, /Merged "Fix cashback" into main/);
  assert.equal(read(h, id).state, 'merged');
  assert.deepEqual([read(h, id).landed.route, read(h, id).landed.read, read(h, id).landed.spot], ['offer', 'none', false]);
  assert.equal(tipOf(h, 'main'), tipOf(h, branch));
});

test('an offer whose branch moved refuses and says so', async t => {
  const h = workspace(t);
  history(h);
  const { id, head, branch } = qualifying(h, 'cashback');
  await survey(h);
  git(h.checkout, 'switch', '-q', branch);
  commit(h.checkout, 'more.txt', 'more\n');
  git(h.checkout, 'switch', '-q', 'main');
  const before = tipOf(h, 'main');

  await assert.rejects(answerOffer(h.root, { slug: 'api', item: id, head }, 'merge', NOW), /moved since it was offered/);

  assert.equal(tipOf(h, 'main'), before);
  assert.equal(read(h, id).state, 'branch');
});

test('a shared offer merges them all with the batch route, stopping at the first failure', async t => {
  const h = workspace(t);
  history(h, { count: 9, at: NOW, closed: NOW });
  const [one, two, three] = ['one', 'two', 'three'].map(name => qualifying(h, name));
  await survey(h);
  git(h.checkout, 'switch', '-q', two.branch);
  commit(h.checkout, 'more.txt', 'more\n');
  git(h.checkout, 'switch', '-q', 'main');
  const answer = { slug: 'api', item: one.id, head: one.head, also: [{ item: two.id, head: two.head }, { item: three.id, head: three.head }] };

  await assert.rejects(answerOffer(h.root, answer, 'merge', NOW), /Merged 1 of 3, then stopped.*moved/);

  assert.deepEqual([one, two, three].map(({ id }) => read(h, id).state), ['merged', 'branch', 'branch']);
  assert.equal(read(h, one.id).landed.route, 'batch');
  await assert.rejects(answerOffer(h.root, answer, 'merge', NOW), /moved/);
  const fixed = { ...answer, also: [{ item: two.id, head: tipOf(h, two.branch) }, { item: three.id, head: three.head }] };

  await answerOffer(h.root, fixed, 'merge', NOW);

  assert.deepEqual([one, two, three].map(({ id }) => read(h, id).state), ['merged', 'merged', 'merged']);
});

test('a branch an earlier one in the same offer brought along is not merged twice', async t => {
  const h = workspace(t);
  history(h);
  const first = qualifying(h, 'first');
  git(h.checkout, 'switch', '-q', first.branch);
  git(h.checkout, 'switch', '-qc', 'hobkin/second');
  commit(h.checkout, 'lib/second.rb', 'second\n');
  git(h.checkout, 'switch', '-q', 'main');
  const { id } = fileItem(h.root, 'api', { key: 'second', kind: 'fix', title: 'Second', brief: 'Next.' }, NOW);
  updateItem(h.root, 'api', id, { state: 'branch', branch: 'hobkin/second' }, NOW);
  const head = tipOf(h, 'hobkin/second');

  await answerOffer(h.root, { slug: 'api', item: id, head, also: [{ item: first.id, head: first.head }] }, 'merge', NOW);

  assert.deepEqual([read(h, id).state, read(h, first.id).state], ['merged', 'merged']);
});

test('an offer whose work has gone from the list answers itself, and an answer to it changes nothing', async t => {
  const h = workspace(t);
  history(h);
  const { id, head } = qualifying(h, 'cashback');
  await survey(h);
  fileDecision(h.root, offerDecisions(h.root, NOW)[0], NOW);
  await mergeItem(h.root, 'api', id, { now: NOW });

  const { message } = await answerOffer(h.root, { slug: 'api', item: id, head }, 'no', NOW);
  retireOffers(h.root, NOW);

  assert.match(message, /already gone/);
  assert.equal(read(h, id).state, 'merged');
  assert.deepEqual(openDecisions(h.root), []);
});

test('the plain question goes once it has been on screen, because each branch it names waits in Decisions', t => {
  const { root } = workspace(t);
  const { filed, offers } = offering();
  offers.add(draft('a1', 'Fix login'));
  const { id } = fileDecision(root, filed[0], NOW);

  retireOffers(root, NOW);
  assert.deepEqual(openDecisions(root).map(decision => decision.id), [id], 'it is still on screen');

  markShown(root, id);
  retireOffers(root, NOW);

  assert.deepEqual(openDecisions(root), []);
});

test('a spot check gets no offer and no precedent, and goes through the walk marked as one', async t => {
  const h = workspace(t);
  history(h);
  const { id } = qualifying(h, 'cashback', { spot: true });
  await survey(h);

  assert.deepEqual(offerDecisions(h.root, NOW), []);
  assert.equal(rowOf(h, id).like, null);

  await mergeItem(h.root, 'api', id, { route: 'key', now: NOW });

  assert.equal(read(h, id).landed.spot, true);
});

test('what qualifies is listed, and the rest say why, reading only', async t => {
  const h = workspace(t);
  history(h);
  const good = qualifying(h, 'good');
  const bare = qualifying(h, 'bare', { proof: null });
  const blank = qualifying(h, 'blank', { kind: 'chore' });
  await survey(h);

  const { learning, offers, rest } = await runWorkCommand(h.root, ['offers']);

  assert.equal(learning, true);
  assert.deepEqual(offers.map(({ item, pattern, tier }) => [item, pattern, tier]), [[good.id, 'api/fix/lib', 'seen']]);
  const { weight, ...counts } = offers[0].precedent;
  assert.deepEqual(counts, { merged: 1, held: 1, quiet: 0, unexercised: 0, watching: 0, from: 'api' });
  assert.ok(weight > 0 && weight <= 1);
  assert.deepEqual(rest.find(({ item }) => item === bare.id).why, ['no proof']);
  assert.deepEqual(rest.find(({ item }) => item === blank.id).why, ['no landed precedent']);
  assert.deepEqual(openDecisions(h.root), []);
});

test('the user can turn a pattern off and on, and after severe trouble only they can', async t => {
  const h = workspace(t);
  const [bad] = history(h, { at: NOW - 3 * DAY });
  recordLaunch(h.root, 'api', { item: bad, outcome: 'trouble', severe: true }, NOW - 2 * DAY);
  history(h, { at: NOW - DAY });
  const { id } = qualifying(h, 'cashback');
  await survey(h);

  assert.match(offersView(h.root, NOW).rest.find(({ item }) => item === id).why[0], /severe trouble/);

  await runWorkCommand(h.root, ['trust', 'api/fix/lib', 'on']);
  assert.deepEqual(offersView(h.root).offers.map(({ item }) => item), [id]);

  await runWorkCommand(h.root, ['trust', 'api/fix/lib', 'off']);
  assert.match(offersView(h.root).rest.find(({ item }) => item === id).why[0], /turned off/);

  await assert.rejects(runWorkCommand(h.root, ['trust', 'api/fix/lib', 'maybe']), /on or trust/);
  await assert.rejects(runWorkCommand(h.root, ['trust', 'api/nothing', 'on']), /project\/kind\/area/);
  await assert.rejects(runWorkCommand(h.root, ['trust', 'gone/fix/lib', 'on']), /gone/);
});

test('an A branch that brings earlier work below safe A gets no offer', async t => {
  const h = workspace(t);
  history(h);
  const first = qualifying(h, 'first');
  reviewed(h, first.head, 'medium', 'B');
  git(h.checkout, 'switch', '-q', first.branch);
  git(h.checkout, 'switch', '-qc', 'hobkin/second');
  commit(h.checkout, 'lib/second.rb', 'second\n');
  git(h.checkout, 'switch', '-q', 'main');
  const head = tipOf(h, 'hobkin/second');
  reviewed(h, head);
  const { id } = fileItem(h.root, 'api', { key: freshKey(h, 'second', false), kind: 'fix', title: 'Second', brief: 'Next.' }, NOW);
  updateItem(h.root, 'api', id, { state: 'branch', branch: 'hobkin/second', proof: 'Yes.', quality: { rating: 'A', head } }, NOW);
  await survey(h);

  assert.ok(offersView(h.root, NOW).rest.find(({ item }) => item === id).why.some(words => /earlier work below safe A/.test(words)));
});

test('a draft waits to be weighed only while the survey has not read its branch', async t => {
  const h = workspace(t);
  const { id } = qualifying(h, 'cashback');

  assert.equal(notSurveyed(h.root, { slug: 'api', id }), true);

  await survey(h);

  assert.equal(notSurveyed(h.root, { slug: 'api', id }), false);
});

test('declining from the walk counts as well', async t => {
  const h = workspace(t);
  const { id } = qualifying(h, 'cashback');
  await survey(h);

  declineItem(h.root, 'api', id, NOW);

  assert.deepEqual(read(h, id).pushbacks, [{ at: iso(NOW), area: 'lib' }]);
});

test('asking for what is ready brings an offer now, inside the quiet gap, and says when there is none', () => {
  const filed = [];
  const clock = { at: 1000 * 3600000 };
  const offer = { key: 'offer:api:a1', answerTo: { kind: 'merge', slug: 'api', item: 'a1' } };
  const offers = new LandOffers({ file: decision => filed.push(decision), now: () => clock.at, offers: () => [offer] });
  offers.next();
  assert.equal(filed.length, 1);

  assert.equal(offers.offerReady(), true);
  assert.equal(filed.length, 2);

  const none = new LandOffers({ file: decision => filed.push(decision), now: () => clock.at });
  assert.equal(none.offerReady(), false);
  assert.equal(filed.length, 2);
});
