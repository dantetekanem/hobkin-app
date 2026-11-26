import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaOf, offerFor, patternOf, trackRecords } from '../src/cli/work/patterns.mjs';

const DAY = 24 * 3600000;
const NOW = Date.parse('2026-06-01T12:00:00Z');
const daysAgo = days => new Date(NOW - days * DAY).toISOString();
const file = (path, lines = 1) => ({ path, lines });

let serial = 0;
function landedItem(outcome, { days = 1, slug = 'api', kind = 'fix', area = 'app/models', closedDays = days - 1, severe = false, ...rest } = {}) {
  serial += 1;
  const id = `item${serial}`;
  const item = { id, kind, title: `Fix ${serial}`, state: 'merged', landed: { sha: 'abc', at: daysAgo(days), route: 'key', area, spot: false }, ...rest };
  const launch = outcome ? { item: id, outcome, severe, mergedAt: daysAgo(days), updatedAt: daysAgo(closedDays) } : { item: id, stage: 'merged', mergedAt: daysAgo(days) };
  return { slug, item, launch };
}

function records(entries, trust = []) {
  const slugs = [...new Set(entries.map(({ slug }) => slug))];
  const projects = slugs.map(slug => {
    const own = entries.filter(entry => entry.slug === slug);
    return { slug, items: own.map(({ item }) => item), launches: own.flatMap(({ launch }) => (launch ? [launch] : [])) };
  });
  return trackRecords(projects, trust, NOW);
}

const pattern = 'api/fix/app/models';

const cleanUnit = {
  sha: 'tip',
  area: 'app/models',
  conflict: false,
  size: { additions: 20, deletions: 11, files: 2 },
  paths: ['app/models/fee.rb', 'app/models/rate.rb'],
  deletedTests: [],
  safety: { grade: 'safe', rating: 'A' },
};
const cleanItem = (id = 'plain1') => ({ id, kind: 'fix', title: 'Fix rounding', proof: 'It failed, then it passed.', quality: { rating: 'A', head: 'tip' } });
const judged = (item, unit, seen, rest = {}) => offerFor({ slug: 'api', item, unit, gap: 'land', records: seen, ...rest });
// One in five goes to the spot check, so every other test uses an id that does not.
const seenOnce = records([landedItem('held')]);

test('an area is the two folders holding the most changed lines, leaving out tests and docs', () => {
  assert.equal(areaOf([file('app/models/fee.rb', 3), file('app/views/x/y.erb', 9), file('test/fee_test.rb', 90), file('README.md', 90)]), 'app/views');
  assert.equal(areaOf([file('src/cli.mjs')]), 'src');
  assert.equal(areaOf([file('app.txt')]), 'root');
});

test('docs, tests and deps name a branch that touches nothing else', () => {
  assert.equal(areaOf([file('README.md'), file('docs/guide.txt')]), 'docs');
  assert.equal(areaOf([file('test/one.test.mjs'), file('spec/two_spec.rb')]), 'tests');
  assert.equal(areaOf([file('package.json'), file('pnpm-lock.yaml'), file('CHANGELOG.md')]), 'deps');
  assert.equal(areaOf([file('README.md'), file('test/one.test.mjs')]), 'multi');
});

test('past two areas a branch is multi, and with nothing changed it has no area', () => {
  assert.equal(areaOf([file('a/one.rb'), file('b/two.rb'), file('c/three.rb')]), 'multi');
  assert.equal(areaOf([file('a/one.rb', 1), file('b/two.rb', 2)]), 'b');
  assert.equal(areaOf([]), null);
});

test('a pattern is the project, the kind and the area, and needs an area', () => {
  assert.equal(patternOf({ slug: 'api', kind: 'fix', area: 'app/models' }), pattern);
  assert.equal(patternOf({ slug: 'api', kind: 'fix', area: null }), null);
});

test('each outcome weighs what the table says, and one still in its watch weighs nothing yet', () => {
  const seen = records([landedItem('held'), landedItem('quiet'), landedItem('unexercised'), landedItem(null)]).get(pattern);

  assert.deepEqual([seen.merged, seen.held, seen.quiet, seen.unexercised, seen.watching], [4, 1, 1, 1, 1]);
  assert.ok(Math.abs(seen.weight - 1.5) < 0.02);
});

test('a landing with no launch yet is still in its watch', () => {
  const { item, slug } = landedItem(null);

  assert.equal(records([{ slug, item }]).get(pattern).watching, 1);
});

test('weights halve every 90 days', () => {
  assert.ok(Math.abs(records([landedItem('held', { days: 90 })]).get(pattern).weight - 0.5) < 0.01);
  assert.ok(Math.abs(records([landedItem('held', { days: 180 })]).get(pattern).weight - 0.25) < 0.01);
});

test('trouble resets the pattern, and what lands after starts again', () => {
  const entries = [landedItem('held', { days: 20 }), landedItem('trouble', { days: 10, closedDays: 5 }), landedItem('held', { days: 2 })];
  const seen = records(entries).get(pattern);

  assert.deepEqual([seen.merged, seen.held], [1, 1]);
  assert.ok(seen.weight > 0.9 && seen.weight <= 1);
  assert.equal(records(entries.slice(0, 2)).get(pattern).merged, 0);
});

test('a no or a sent-back branch takes one off the clean weight, down to zero', () => {
  const onePushback = { at: daysAgo(1), area: 'app/models' };
  const pushedBack = { id: 'pushed', kind: 'fix', title: 'Another', state: 'declined', pushbacks: [onePushback] };
  const pushedBackTwice = { ...pushedBack, pushbacks: [onePushback, onePushback] };
  const held = [landedItem('held', { days: 3 }), landedItem('held', { days: 3 }), landedItem('held', { days: 3 })];

  const threeHeldOneNo = records([...held, { slug: 'api', item: pushedBack }]);
  const oneHeldTwoNos = records([held[0], { slug: 'api', item: pushedBackTwice }]);

  assert.ok(Math.abs(threeHeldOneNo.get(pattern).weight - 2) < 0.1);
  assert.equal(oneHeldTwoNos.get(pattern).weight, 0);
});

test('severe trouble turns the pattern off until the user turns it back on', () => {
  const severe = landedItem('trouble', { severe: true, days: 3, closedDays: 2 });

  assert.equal(records([severe]).get(pattern).off, 'severe');
  assert.equal(records([severe], [{ pattern, on: true, at: daysAgo(1) }]).get(pattern).off, null);
  assert.equal(records([severe], [{ pattern, on: true, at: daysAgo(10) }]).get(pattern).off, 'severe');
});

test('the user can turn a pattern off before it has any record', () => {
  assert.equal(records([], [{ pattern, on: false, at: daysAgo(1) }]).get(pattern).off, 'user');
});

test('no landed precedent gets no offer, and one precedent is seen', () => {
  const blank = judged(cleanItem(), cleanUnit, new Map());
  const seen = judged(cleanItem(), cleanUnit, seenOnce);

  assert.deepEqual([blank.tier, blank.offerable], ['new', false]);
  assert.match(blank.why[0], /no landed precedent/);
  assert.deepEqual([seen.tier, seen.offerable, seen.why], ['seen', true, []]);
  assert.equal(seen.precedent.merged, 1);
});

test('eight clean is earned, and seven and a half is not', () => {
  const held = count => Array.from({ length: count }, () => landedItem('held', { days: 0, closedDays: 0 }));

  assert.equal(judged(cleanItem(), cleanUnit, records(held(8))).tier, 'earned');
  assert.equal(judged(cleanItem(), cleanUnit, records([...held(7), landedItem('quiet', { days: 0, closedDays: 0 })])).tier, 'seen');
});

test('after trouble nothing is offered until something lands clean again', () => {
  const offer = judged(cleanItem(), cleanUnit, records([landedItem('held', { days: 9 }), landedItem('trouble', { days: 3, closedDays: 2 })]));

  assert.deepEqual([offer.tier, offer.offerable], ['new', false]);
  assert.match(offer.why[0], /trouble/);
});

const vetoes = [
  ['below safe A', {}, { safety: { grade: 'safe', rating: 'B' } }, /below safe A/],
  ['a medium grade', {}, { safety: { grade: 'medium', rating: 'A' } }, /below safe A/],
  ['no grade', {}, { safety: null }, /no safety grade/],
  ['a stale grade', {}, { safety: { grade: 'safe', rating: 'A', stale: true } }, /older commit/],
  ['quality below B', { quality: { rating: 'C', head: 'tip' } }, {}, /quality below B/],
  ['no quality grade', { quality: undefined }, {}, /no quality grade/],
  ['a stale quality grade', { quality: { rating: 'A', head: 'older' } }, {}, /older commit/],
  ['over 300 lines', {}, { size: { additions: 300, deletions: 1, files: 2 } }, /300/],
  ['multi', {}, { area: 'multi' }, /areas/],
  ['a conflict', {}, { conflict: true }, /conflict/],
  ['an unknown conflict', {}, { conflict: null }, /conflict/],
  ['no proof', { proof: undefined }, {}, /no proof/],
  ['something left', { left: 'Rotate the key.' }, {}, /left/],
  ['deleted tests', {}, { deletedTests: ['test/old.test.js'] }, /deletes tests/],
  ['one-way undo', { launch: { undo: 'one-way' } }, {}, /undo/],
  ['permanent undo', { launch: { undo: 'permanent' } }, {}, /undo/],
  ['a path cut short', {}, { size: { additions: 20, deletions: 0, files: 3 } }, /too many files/],
  ['no survey yet', {}, { area: undefined }, /not read/],
];

for (const [name, itemChange, unitChange, reason] of vetoes) {
  test(`${name} gets no offer, whatever its history`, () => {
    const item = { ...cleanItem(), ...itemChange };
    const unit = { ...cleanUnit, ...unitChange };
    const seen = unit.area === cleanUnit.area ? records(Array.from({ length: 9 }, () => landedItem('held', { days: 0.01, closedDays: 0 }))) : new Map();
    const offer = judged(item, unit, seen);

    assert.equal(offer.offerable, false);
    assert.ok(offer.why.some(words => reason.test(words)), offer.why.join('; '));
  });
}

for (const path of ['db/migrate/1_add.rb', 'db/schema.rb', 'app/auth/login.rb', 'lib/sessions/store.rb', 'lib/tokens.rb', 'config/secrets.yml', 'app/payments/card.rb', 'app/billing/run.rb', '.github/workflows/ci.yml', 'config/deploy.yml', '.kamal/hooks/post-deploy', 'Dockerfile', 'ci/run.sh']) {
  test(`a path like ${path} gets no offer`, () => {
    const offer = judged(cleanItem(), { ...cleanUnit, paths: ['app/models/fee.rb', path] }, seenOnce);

    assert.equal(offer.offerable, false);
    assert.ok(offer.why.some(words => words.includes(path)));
  });
}

test('ordinary words do not trip the path check', () => {
  assert.equal(judged(cleanItem(), { ...cleanUnit, paths: ['app/models/city.rb', 'app/models/price.rb'] }, seenOnce).offerable, true);
});

test('a branch of markdown alone needs no grades, because no review reads one', () => {
  const unit = { ...cleanUnit, area: 'docs', onlyDocs: true, safety: null, paths: ['README.md', 'docs/guide.md'] };
  const offer = judged({ ...cleanItem(), quality: undefined }, unit, records([landedItem('held', { area: 'docs' })]));

  assert.equal(offer.offerable, true);
});

test('a safe A branch that brings earlier work below safe A with it gets no offer', () => {
  const beneath = [{ branch: 'hobkin/first', safety: { grade: 'safe', rating: 'A' } }, { branch: 'hobkin/second', safety: { grade: 'medium', rating: 'B' } }];
  const offer = judged(cleanItem(), cleanUnit, seenOnce, { beneath });

  assert.equal(offer.offerable, false);
  assert.ok(offer.why.some(words => /earlier/.test(words)));
  assert.equal(judged(cleanItem(), cleanUnit, seenOnce, { beneath: beneath.slice(0, 1) }).offerable, true);
});

test('only a row with nothing in its way can be offered', () => {
  for (const gap of ['elsewhere', 'stacked', 'closing', 'yours', 'unlanded']) assert.equal(judged(cleanItem(), cleanUnit, seenOnce, { gap }).offerable, false, gap);
});

test('docs, tests and deps can take a precedent from another project, and the offer says where from', () => {
  const unit = { ...cleanUnit, area: 'deps', paths: ['package.json', 'pnpm-lock.yaml'] };
  const elsewhere = records([landedItem('held', { slug: 'site', area: 'deps' })]);
  const offer = judged(cleanItem(), unit, elsewhere);

  assert.deepEqual([offer.tier, offer.offerable, offer.precedent.slug], ['seen', true, 'site']);
});

test('a precedent from another project counts for nothing else', () => {
  assert.equal(judged(cleanItem(), cleanUnit, records([landedItem('held', { slug: 'site' })])).tier, 'new');
});

test('trouble here is not washed out by a clean record elsewhere', () => {
  const unit = { ...cleanUnit, area: 'deps', paths: ['package.json'] };
  const seen = records([landedItem('held', { slug: 'site', area: 'deps' }), landedItem('trouble', { area: 'deps' })]);

  assert.equal(judged(cleanItem(), unit, seen).tier, 'new');
});

test('a pattern switched off gets no offer, here or from elsewhere', () => {
  const unit = { ...cleanUnit, area: 'deps', paths: ['package.json'] };
  const switched = (name, on) => [{ pattern: name, on, at: daysAgo(0) }];
  const elsewhere = [landedItem('held', { slug: 'site', area: 'deps' })];

  assert.equal(judged(cleanItem(), unit, records(elsewhere, switched('api/fix/deps', false))).offerable, false);
  assert.equal(judged(cleanItem(), unit, records(elsewhere, switched('site/fix/deps', false))).tier, 'new');
  assert.match(judged(cleanItem(), cleanUnit, records([landedItem('held')], switched(pattern, false))).why[0], /turned off/);
});

test('one qualifying item in five is a spot check, with no offer and no precedent, and always the same ones', () => {
  const offers = Array.from({ length: 500 }, (_, index) => judged(cleanItem(`row${index}`), cleanUnit, seenOnce));
  const spots = offers.filter(({ spot }) => spot);

  assert.ok(spots.length > 70 && spots.length < 130, String(spots.length));
  assert.ok(spots.every(({ offerable, precedent }) => !offerable && precedent === null));
  assert.equal(judged(cleanItem('row3'), cleanUnit, seenOnce).spot, offers[3].spot);
});

test('a spot check only ever falls on what qualifies', () => {
  const offers = Array.from({ length: 50 }, (_, index) => judged({ ...cleanItem(`row${index}`), proof: undefined }, cleanUnit, seenOnce));

  assert.ok(offers.every(({ spot, precedent }) => !spot && precedent));
});
