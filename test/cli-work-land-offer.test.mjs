import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LandOffers } from '../src/cli/work/land-offer.mjs';

const HOUR = 3600000;
const draft = (id, title = `Fix ${id}`) => ({ slug: 'api', id, project: 'API', title });

/** Answers the questions in order, and `undefined` once it runs out, which is a dashboard that could not ask. */
function offering(answers = []) {
  const asked = [];
  let walked = 0;
  const clock = { at: 1000 * HOUR };
  const offers = new LandOffers({
    ask: async request => {
      asked.push(request);
      return answers.shift();
    },
    walk: () => { walked += 1; },
    now: () => clock.at,
  });
  return { asked, offers, clock, walked: () => walked };
}

test('a finished branch asks whether to walk it, with not now first', async () => {
  const { asked, offers } = offering([null]);

  await offers.add(draft('a1', 'Fix login'));

  const [{ question, choices, whenQuiet }] = asked;
  assert.match(question, /Fix login on API can land/);
  assert.equal(choices[0].label, 'Not now', 'a question can open as the user presses Enter');
  assert.equal(whenQuiet, true);
});

test('a yes opens the walk, and nothing else does', async () => {
  const yes = offering(['walk']);
  await yes.offers.add(draft('a1'));
  assert.equal(yes.walked(), 1);

  const notNow = offering(['no']);
  await notNow.offers.add(draft('a1'));
  assert.equal(notNow.walked(), 0);
});

test('a question that could not open is asked on the next tick, with everything waiting', async () => {
  const { asked, offers } = offering([undefined, 'no']);

  await offers.add(draft('a1'));
  offers.waiting.push(draft('a2'));
  await offers.next();

  assert.match(asked[1].question, /2 finished branches can land/);
});

test('branches that finish together are one question, and a run of them waits two hours for the next', async () => {
  const { asked, offers, clock } = offering(['no', 'no']);

  await offers.add(draft('a1'));
  await offers.add(draft('a2'));
  assert.equal(asked.length, 1);

  clock.at += 2 * HOUR;
  await offers.next();

  assert.equal(asked.length, 2);
  assert.match(asked[1].question, /Fix a2 on API/);
});

test('with no way to ask, nothing is lost', async () => {
  const offers = new LandOffers({});

  await offers.add(draft('a1'));

  assert.equal(offers.waiting.length, 1);
});
