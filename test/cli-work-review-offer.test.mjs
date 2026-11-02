import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReviewOffers } from '../src/cli/work/review-offer.mjs';

const draft = (id, title = `Fix ${id}`) => ({ slug: 'api', id, project: 'API', title });

/** Answers the questions in order, and `undefined` once it runs out, which is a dashboard that could not ask. */
function offering(answers = []) {
  const asked = [];
  const reviewed = [];
  const offers = new ReviewOffers({
    ask: async request => {
      asked.push(request);
      return answers.shift();
    },
    review: async ({ id }) => { reviewed.push(id); },
  });
  return { asked, reviewed, offers };
}

test('a finished draft asks the user whether to review it, with not now first', async () => {
  const { asked, offers } = offering([null]);

  await offers.add(draft('a1', 'Fix login'));

  const [{ question, choices, whenQuiet, other }] = asked;
  assert.match(question, /Draft is done/);
  assert.match(question, /Fix login/);
  assert.match(question, /API/);
  assert.match(question, /want to review/i);
  assert.equal(choices[0].label, 'Not now', 'a question can open as the user presses Enter');
  assert.equal(choices.length, 2);
  assert.equal(whenQuiet, true);
  assert.equal(other, undefined, 'the answer has to be a draft or nothing');
});

test('a yes reviews that draft, and nothing else does', async () => {
  const yes = offering(['api:a1']);
  await yes.offers.add(draft('a1'));
  assert.deepEqual(yes.reviewed, ['a1']);

  const notNow = offering(['no']);
  await notNow.offers.add(draft('a1'));
  assert.deepEqual(notNow.reviewed, []);

  const escaped = offering([null]);
  await escaped.offers.add(draft('a1'));
  assert.deepEqual(escaped.reviewed, []);
});

test('an answer that names no draft reviews nothing', async () => {
  const { offers, reviewed } = offering(['api:forged']);

  await offers.add(draft('a1'));

  assert.deepEqual(reviewed, []);
});

test('drafts that finish while a question is open go in one question after it, not one each', async () => {
  let answerFirst;
  const asked = [];
  const reviewed = [];
  const offers = new ReviewOffers({
    ask: request => {
      asked.push(request);
      return asked.length === 1 ? new Promise(resolve => { answerFirst = resolve; }) : Promise.resolve('api:c3');
    },
    review: async ({ id }) => { reviewed.push(id); },
  });

  const first = offers.add(draft('a1'));
  await offers.add(draft('b2'));
  await offers.add(draft('c3', 'Fix billing'));
  assert.equal(asked.length, 1, 'only one question is ever open');

  answerFirst(null);
  await first;

  assert.equal(asked.length, 2);
  assert.match(asked[1].question, /2 drafts are done/);
  assert.deepEqual(asked[1].choices.map(choice => choice.label), ['Not now', 'Review API: Fix b2', 'Review API: Fix billing']);
  assert.deepEqual(reviewed, ['c3']);
});

test('a question lists five drafts at most and says how many more are in READY', async () => {
  const { asked, offers } = offering();
  offers.waiting.push(...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => draft(id)));

  await offers.next();

  assert.equal(asked[0].choices.length, 6);
  assert.match(asked[0].question, /7 drafts are done/);
  assert.match(asked[0].question, /2 more in READY/);
});

test('a question that could not open waits for the next tick', async () => {
  const { asked, offers, reviewed } = offering([undefined, 'api:a1']);

  await offers.add(draft('a1'));
  assert.equal(asked.length, 1);
  assert.deepEqual(reviewed, []);

  await offers.next();
  assert.equal(asked.length, 2);
  assert.deepEqual(reviewed, ['a1']);

  await offers.next();
  assert.equal(asked.length, 2, 'an answered draft is not asked about again');
});

test('a dashboard that throws costs the offer, not the tick', async () => {
  const offers = new ReviewOffers({ ask: async () => { throw Error('It stopped.'); }, review: async () => assert.fail('Nothing was chosen.') });

  await offers.add(draft('a1'));
});

test('a yes that cannot start costs nothing else, and the next question still opens', async () => {
  const asked = [];
  const offers = new ReviewOffers({
    ask: async request => {
      asked.push(request);
      return request.choices[1].value;
    },
    review: async () => { throw Error('Already running.'); },
  });

  await offers.add(draft('a1'));
  await offers.add(draft('b2'));

  assert.equal(asked.length, 2);
});

test('text an agent wrote cannot reach the terminal as control characters', async () => {
  const { asked, offers } = offering();

  await offers.add(draft('a1', 'Fix\x1b[2J login\n'));

  assert.doesNotMatch(asked[0].question, /\x1b|\n/);
});

test('with no dashboard there is nothing to ask', async () => {
  const offers = new ReviewOffers({ review: async () => assert.fail('Nothing was chosen.') });

  await offers.add(draft('a1'));
  await offers.next();
});
