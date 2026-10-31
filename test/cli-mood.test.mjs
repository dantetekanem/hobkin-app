import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moods as allMoods } from '../src/cli/face.mjs';
import { askJev, Moods } from '../src/cli/mood.mjs';

function fixture({ enabled = true, answer = 'surprised' } = {}) {
  const h = { clock: 100000, asked: [], enabled, answer };
  h.moods = new Moods({
    enabled: () => h.enabled,
    ask: async state => {
      h.asked.push(state);
      if (h.answer instanceof Error) throw h.answer;
      return h.answer;
    },
    now: () => h.clock,
  });
  h.settle = () => new Promise(resolve => { setImmediate(resolve); });
  return h;
}

const view = (patch = {}) => ({ messages: [], runs: [], busy: false, ...patch });
const report = (tone, id = 'one') => ({ messages: [{ id, role: 'notice', content: 'Email follow-ups: two replies are due.', tone }] });
const check = title => ({ title, state: 'running', kind: 'background' });

test('without Jev a good report makes Hobkin happy, and nothing leaves the machine', async () => {
  const h = fixture({ enabled: false });
  h.moods.observe(view());

  h.moods.observe(view(report('useful')));
  await h.settle();

  assert.equal(h.moods.reaction.mood, 'happy');
  assert.deepEqual(h.asked, []);
});

test('a request for more tokens is no reason to look happy', async () => {
  const h = fixture({ enabled: false });
  h.moods.observe(view());

  h.moods.observe(view({ messages: [{ id: 'notice:work-allowance:2026', role: 'notice', content: 'Work mode paused.', tone: 'useful' }] }));

  assert.equal(h.moods.reaction, null);
});

test('without Jev there is no mood for bad news, so the face stays on the work', async () => {
  const h = fixture({ enabled: false });
  h.moods.observe(view());

  h.moods.observe(view(report('critical')));
  await h.settle();

  assert.equal(h.moods.reaction, null);
});

test('a reaction wears off', async () => {
  const h = fixture({ enabled: false });
  h.moods.observe(view());
  h.moods.observe(view(report('useful')));

  assert.ok(h.moods.reaction.until > h.clock);
  assert.ok(h.moods.reaction.until - h.clock <= 60000);
});

test('with Jev a report goes out with its outcome, and any mood can come back', async () => {
  const h = fixture({ answer: 'sad' });
  h.moods.observe(view());
  await h.settle();
  h.asked.length = 0;
  h.clock += 60000;

  h.moods.observe(view(report('critical')));
  await h.settle();

  assert.equal(h.moods.reaction.mood, 'sad');
  assert.match(h.asked[0].event, /report/i);
  assert.equal(h.asked[0].outcome, 'critical');
  assert.match(h.asked[0].report, /two replies are due/);
});

test('work is a moment too: a schedule or work agent starting or ending, a pause, a finished turn', async () => {
  const moments = [
    [view(), view({ runs: [check('Email follow-ups')] }), /Email follow-ups/],
    [view({ runs: [check('Email follow-ups')] }), view(), /finished/],
    [view({ work: { paused: false } }), view({ work: { paused: true } }), /paused/],
    [view({ busy: true }), view(), /finished replying/],
    [view(), view({ messages: [{ id: 'two', role: 'user', content: 'thank you!' }] }), /user/],
  ];
  for (const [before, after, expected] of moments) {
    const h = fixture();
    h.moods.observe(before);
    await h.settle();
    h.asked.length = 0;
    h.clock += 60000;

    h.moods.observe(after);
    await h.settle();

    assert.match(h.asked[0]?.event ?? '', expected);
  }
});

test('what was just said goes with the moment, so Jev can read the room', async () => {
  const h = fixture();
  const said = { messages: [{ id: 'a', role: 'user', content: 'Ship it.' }, { id: 'b', role: 'assistant', content: 'Merged and deployed.' }] };
  h.moods.observe(view({ ...said, busy: true }));
  await h.settle();
  h.asked.length = 0;
  h.clock += 60000;

  h.moods.observe(view(said));
  await h.settle();

  assert.equal(h.asked[0].userSaid, 'Ship it.');
  assert.equal(h.asked[0].agentSaid, 'Merged and deployed.');
});

test('a refresh with nothing new asks nothing', async () => {
  const h = fixture();
  h.moods.observe(view());
  await h.settle();
  h.asked.length = 0;
  h.clock += 60000;

  h.moods.observe(view());
  await h.settle();

  assert.deepEqual(h.asked, []);
});

test('moments arriving quickly are read one at a time, and the newest wins', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture();
  h.moods.observe(view());
  await h.settle();
  h.asked.length = 0;
  h.clock += 60000;

  h.moods.observe(view({ runs: [check('First')] }));
  h.moods.observe(view({ runs: [check('First'), check('Second')] }));
  h.moods.observe(view({ runs: [check('First'), check('Second'), check('Third')] }));
  await h.settle();
  assert.equal(h.asked.length, 1);

  h.clock += 60000;
  t.mock.timers.tick(60000);
  await h.settle();

  assert.equal(h.asked.length, 2);
  assert.match(h.asked[1].event, /Third/);
});

test('a mood the design does not have is ignored', async () => {
  const h = fixture({ answer: 'furious' });
  h.moods.observe(view());
  await h.settle();
  h.clock += 60000;

  h.moods.observe(view(report('useful')));
  await h.settle();

  assert.notEqual(h.moods.reaction?.mood, 'furious');
});

test('when Jev cannot answer, the four default moods carry on', async () => {
  const h = fixture({ answer: Error('Jev answered 503.') });
  h.moods.observe(view());
  await h.settle();
  h.clock += 60000;

  h.moods.observe(view(report('useful')));
  await h.settle();

  assert.equal(h.moods.reaction.mood, 'happy');
});

test('a long quiet goes to Jev once, and that mood lasts until something happens', async () => {
  const h = fixture({ answer: 'sleepy' });
  h.moods.observe(view());
  await h.settle();
  h.asked.length = 0;

  h.clock += 20 * 60000;
  h.moods.notice();
  h.moods.notice();
  await h.settle();

  assert.equal(h.asked.length, 1);
  assert.match(h.asked[0].event, /quiet/i);
  h.clock += 6 * 3600000;
  assert.ok(h.moods.reaction.until > h.clock);

  h.answer = 'hello';
  h.moods.observe(view({ messages: [{ id: 'c', role: 'user', content: 'hi' }] }));
  await h.settle();

  assert.equal(h.moods.reaction.mood, 'hello');
});

test('a request to Jev is one Choice over every mood', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ answers: { mood: { type: 'choice', choice: 'happy', confidence: 0.9 } } }) };
  };

  const mood = await askJev({ event: 'A report just arrived' }, { key: 'test-key', request });

  assert.equal(mood, 'happy');
  const [{ url, method, headers, body }] = calls;
  assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(method, 'POST');
  assert.equal(headers.authorization, 'Bearer test-key');
  assert.equal(body.model, 'jev-latest');
  assert.deepEqual(body.state, { event: 'A report just arrived' });
  assert.equal(body.questions.mood.type, 'choice');
  assert.deepEqual(Object.keys(body.questions.mood.criteria).toSorted(), allMoods.toSorted());
});

test('a refused request is an error, not a mood', async () => {
  const request = async () => ({ ok: false, status: 401, json: async () => ({}) });

  await assert.rejects(askJev({}, { key: 'bad', request }), /401/);
});
