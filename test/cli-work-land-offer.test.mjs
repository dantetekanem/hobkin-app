import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LandOffers } from '../src/cli/work/land-offer.mjs';

const HOUR = 3600000;
const draft = (id, title = `Fix ${id}`) => ({ slug: 'api', id, project: 'API', title });

function offering() {
  const filed = [];
  const clock = { at: 1000 * HOUR };
  const offers = new LandOffers({ file: decision => filed.push(decision), now: () => clock.at });
  return { filed, offers, clock };
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
