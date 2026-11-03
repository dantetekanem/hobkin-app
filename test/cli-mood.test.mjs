import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moods as allMoods } from '../src/cli/face.mjs';
import { currentMood, moodFor, Moods, searchingTool } from '../src/cli/mood.mjs';
import { createDashboard } from '../src/cli/ui.mjs';

const MINUTE = 60000;

/** Past its first look, so what a test sees is its own moment and not the session starting. */
function started(first = view()) {
  const h = { clock: 100000 };
  h.moods = new Moods({ now: () => h.clock });
  h.moods.observe(first);
  h.moods.reaction = null;
  h.mood = () => h.moods.reaction?.mood;
  return h;
}

const view = (patch = {}) => ({ messages: [], runs: [], busy: false, ...patch });
const report = (tone, id = 'one') => ({ messages: [{ id: `notice:report:${id}`, role: 'notice', content: 'Email follow-ups: two replies are due.', tone }] });
const said = (content, id = 'a') => ({ messages: [{ id, role: 'user', content }] });
const replied = (content, patch = {}) => ({ messages: [{ id: 'r', role: 'assistant', content }], runs: [{ id: 't', kind: 'main', title: 'Conversation', state: 'completed', stopReason: 'stop', ...patch }] });
const job = (id, patch = {}) => ({ id, title: id, state: 'running', kind: 'background', scheduleId: 'digest', ...patch });
const ended = (id, state, patch = {}) => job(id, { state, ...patch });
const turnThen = (content, patch) => {
  const h = started(view({ busy: true }));
  h.finish = () => h.moods.observe(view(replied(content, patch)));
  return h;
};

test('a face gone quiet wakes when the user types, and a passing reaction plays out', () => {
  const asleep = { mood: 'sleepy', lasting: true, until: Number.MAX_SAFE_INTEGER };
  const pleased = { mood: 'happy', until: 2000 };

  assert.equal(currentMood({ reaction: asleep, now: 1000 }), 'sleepy');
  assert.equal(currentMood({ reaction: asleep, typing: true, now: 1000 }), 'listening');
  assert.equal(currentMood({ reaction: pleased, typing: true, now: 1000 }), 'happy');
});

test('typing in the composer wakes the face, and clearing it lets it sleep again', () => {
  const asleep = { mood: 'sleepy', lasting: true, until: Number.MAX_SAFE_INTEGER };
  const ui = createDashboard({
    config: { main: {}, background: { harness: 'pi', model: null, effort: 'medium' } },
    counts: { daily: 0, weekly: 0, monthly: 0 },
    schedules: [],
    reports: [],
    messages: [],
    connection: 'connected',
    runs: [],
    usage: null,
    mood: asleep,
  });
  assert.equal(ui.state().mood, 'sleepy');

  ui.input('h');
  assert.equal(ui.state().mood, 'listening');

  ui.input('\x03');
  assert.equal(ui.state().mood, 'sleepy');
  ui.stop();
});

test('the same moment always gives the same mood, and says why', () => {
  const moments = [
    [{ event: 'session' }, 'hello'],
    [{ event: 'said', text: 'please look at the logs' }, 'listening'],
    [{ event: 'unknown command' }, 'confused'],
    [{ event: 'decision' }, 'listening'],
    [{ event: 'error' }, 'error'],
    [{ event: 'report', tone: 'useful' }, 'happy'],
    [{ event: 'report', tone: 'critical' }, 'surprised'],
    [{ event: 'report', tone: 'blocked' }, 'sad'],
    [{ event: 'merged' }, 'celebrating'],
    [{ event: 'crowded' }, 'dizzy'],
    [{ event: 'context' }, 'dizzy'],
    [{ event: 'limit' }, 'dizzy'],
    [{ event: 'quiet' }, 'sleepy'],
  ];

  for (const [moment, mood] of moments) {
    const first = moodFor(moment);
    assert.equal(first.mood, mood, moment.event);
    assert.ok(first.cause, moment.event);
    assert.deepEqual(moodFor(moment), first);
  }
});

test('a moment that says nothing about the face changes nothing', () => {
  assert.equal(moodFor({ event: 'run started' }), null);
  assert.equal(moodFor({ event: 'report' }), null);
  assert.equal(moodFor({ event: 'run', status: 'completed', stalled: false }), null);
  assert.equal(moodFor({ event: 'turn', status: 'completed', text: 'Done.', ms: 1000 }), null);
  assert.equal(moodFor({ event: 'turn', status: 'interrupted', text: 'Should I go on?', ms: 1000 }), null);
});

test('hello, thanks and a joke read the same in English and Portuguese', () => {
  const lines = [
    ['hello', ['hi', 'Hello!', 'hey hobkin', 'good morning', 'oi', 'Olá', 'bom dia', 'boa noite!', 'e aí']],
    ['love', ['thanks', 'Thank you!', 'thx', 'great job on this', 'obrigado', 'Obrigada!', 'valeu', 'muito bom', 'você mandou bem', 'parabéns']],
    ['wink', ['haha', 'hahaha nice one', 'kkk', 'kkkkk', 'lol', 'that was close :)', 'sure ;)', 'rsrs']],
    ['listening', ['fix the login page', 'hey can you please fix the login page when you get a moment today', 'no thanks', 'corrige a página de login', 'k', 'he said no']],
  ];

  for (const [mood, texts] of lines) {
    for (const text of texts) assert.equal(moodFor({ event: 'said', text }).mood, mood, text);
  }
});

test('hearing the work is bad makes the face sad, in English and Portuguese, the way a reply about a report is read', () => {
  const bad = [
    'dont be happy, you are doing terrible',
    'That is terrible.',
    'this is wrong',
    'you are doing bad',
    'awful work',
    'thanks for nothing, this is terrible',
    'péssimo',
    'está horrível',
    'isso está errado',
    'você está indo péssimo',
    'que trabalho terrível',
  ];
  const fine = [
    'is this wrong?',
    'not bad at all',
    'nothing wrong here',
    'não é tão ruim',
    'not terrible',
    'está horrível?',
  ];

  for (const text of bad) assert.equal(moodFor({ event: 'said', text }).mood, 'sad', text);
  for (const text of fine) assert.notEqual(moodFor({ event: 'said', text }).mood, 'sad', text);
});

test('after hearing the work is bad, the next reaction is never happy or love', () => {
  for (const [moment, mood] of [[report('useful'), 'happy'], [said('thanks', 'b'), 'love']]) {
    const h = started();
    h.moods.observe(view(said('dont be happy, you are doing terrible')));
    assert.equal(h.mood(), 'sad');

    h.moods.observe(view(moment));
    assert.equal(h.mood(), 'sad', `${mood} is held back`);

    h.moods.observe(view(report('useful', 'later')));
    assert.equal(h.mood(), 'happy', 'only the next one');
  }
});

test('after hearing the work is bad, a next reaction of any other kind still shows, and ends the hold', () => {
  const h = started();
  h.moods.observe(view(said('this is wrong')));

  h.moods.observe(view(report('critical')));
  assert.equal(h.mood(), 'surprised');

  h.moods.observe(view(report('useful', 'later')));
  assert.equal(h.mood(), 'happy');
});

test('a useful report is happy, a critical one surprised and a blocked one sad', () => {
  for (const [tone, mood] of [['useful', 'happy'], ['critical', 'surprised'], ['blocked', 'sad']]) {
    const h = started();
    h.moods.observe(view(report(tone)));
    assert.equal(h.mood(), mood);
  }
});

test('a notice that is not a report is no reason to react', () => {
  for (const kind of ['work-allowance', 'work-pause']) {
    const h = started();
    h.moods.observe(view({ messages: [{ id: `notice:${kind}:2026`, role: 'notice', content: 'Work mode paused.', tone: 'useful' }] }));
    assert.equal(h.mood(), undefined);
  }
});

test('how a run ends shows on the face', () => {
  const ends = [
    [ended('one', 'failed', { stalled: true }), 'error'],
    [ended('one', 'interrupted'), 'surprised'],
    [ended('one', 'incomplete', { stalled: true }), 'sad'],
    [ended('one', 'completed', { stalled: true }), 'sad'],
    [ended('one', 'completed'), undefined],
  ];

  for (const [finished, mood] of ends) {
    const h = started(view({ runs: [job('one')] }));
    h.moods.observe(view({ runs: [finished] }));
    assert.equal(h.mood(), mood, finished.state);
  }
});

test('the same routine or item stalling twice running is grumpy', () => {
  const earlier = ended('zero', 'failed', { stalled: true });
  const h = started(view({ runs: [job('one'), earlier] }));

  h.moods.observe(view({ runs: [ended('one', 'completed', { stalled: true }), earlier] }));

  assert.equal(h.mood(), 'grumpy');
});

test('an item is its own subject, whatever else its lane did, and a stopped run does not break a streak', () => {
  const work = item => ({ scheduleId: 'work.site.do', work: { slug: 'site', lane: 'do', item } });
  const other = ended('other', 'failed', { stalled: true, ...work('b') });
  const first = started(view({ runs: [job('one', work('a')), other] }));
  first.moods.observe(view({ runs: [ended('one', 'failed', { stalled: true, ...work('a') }), other] }));
  assert.equal(first.mood(), 'error');

  const earlier = ended('zero', 'failed', { stalled: true, ...work('a') });
  const stopped = ended('stop', 'interrupted', work('a'));
  const second = started(view({ runs: [job('one', work('a')), stopped, earlier] }));
  second.moods.observe(view({ runs: [ended('one', 'failed', { stalled: true, ...work('a') }), stopped, earlier] }));
  assert.equal(second.mood(), 'grumpy');
});

test('how a turn ends shows on the face', () => {
  const ends = [
    ['Merged the branch.', { state: 'failed' }, 'error'],
    ['Partial answer', { state: 'incomplete', stopReason: 'error' }, 'error'],
    ['Partial answer', { state: 'incomplete', stopReason: 'length' }, 'surprised'],
    ['What should I name it?', {}, 'listening'],
    ['Should I go on?**', {}, 'listening'],
    ['Could you clarify which server?', {}, 'confused'],
    ['Pode esclarecer qual servidor?', {}, 'confused'],
    ['Done.', {}, undefined],
  ];

  for (const [content, patch, mood] of ends) {
    const h = turnThen(content, patch);
    h.finish();
    assert.equal(h.mood(), mood, content);
  }
});

test('a long turn that finishes cleanly is happy, and a short one is nothing', () => {
  const long = turnThen('Done.');
  long.clock += 5 * MINUTE;
  long.finish();
  assert.equal(long.mood(), 'happy');

  const short = turnThen('Done.');
  short.clock += 4 * MINUTE;
  short.finish();
  assert.equal(short.mood(), undefined);
});

test('a merge counted anywhere is a celebration, and only a new one', () => {
  const merged = count => ({ work: { projects: [{ slug: 'site', merged: count }, { slug: 'api', merged: 1 }] } });
  const h = started(view(merged(1)));

  h.moods.observe(view(merged(1)));
  assert.equal(h.mood(), undefined);

  h.moods.observe(view(merged(2)));
  assert.equal(h.mood(), 'celebrating');
});

test('too much at once is dizzy, as it happens and not for as long as it lasts', () => {
  const crowd = started(view({ runs: [job('a'), job('b'), job('c')] }));
  crowd.moods.observe(view({ busy: true, runs: [job('a'), job('b'), job('c')] }));
  assert.equal(crowd.mood(), 'dizzy');
  crowd.moods.reaction = null;
  crowd.moods.observe(view({ busy: true, runs: [job('a'), job('b'), job('c')] }));
  assert.equal(crowd.mood(), undefined);

  const full = started(view({ context: { percent: 94 } }));
  full.moods.observe(view({ context: { percent: 95 } }));
  assert.equal(full.mood(), 'dizzy');

  for (const [kind, mood] of [['day', 'dizzy'], ['hour', 'dizzy'], ['usage', 'dizzy'], ['hand', undefined]]) {
    const h = started();
    h.moods.observe(view({ work: { pause: { kind } } }));
    assert.equal(h.mood(), mood, kind);
  }
});

test('a question filed for the user makes the face listen, and an answered one does not', () => {
  const h = started(view({ decisions: [{ id: 'one' }] }));

  h.moods.observe(view({ decisions: [] }));
  assert.equal(h.mood(), undefined);

  h.moods.observe(view({ decisions: [{ id: 'two' }] }));
  assert.equal(h.mood(), 'listening');
});

test('an error reaching the screen shows once', () => {
  const h = started();

  h.moods.observe(view({ error: 'Main chat stopped.' }));
  assert.equal(h.mood(), 'error');
  h.moods.reaction = null;

  h.moods.observe(view({ error: 'Main chat stopped.' }));
  assert.equal(h.mood(), undefined);
});

test('the session starting says hello', () => {
  const moods = new Moods({ now: () => 0 });

  moods.observe(view());

  assert.equal(moods.reaction.mood, 'hello');
});

test('fifteen quiet minutes are sleepy until something happens, and that lasts', () => {
  const h = started();

  h.clock += 14 * MINUTE;
  h.moods.notice();
  assert.equal(h.mood(), undefined);

  h.clock += MINUTE;
  h.moods.notice();
  h.moods.notice();
  assert.equal(h.mood(), 'sleepy');
  h.clock += 360 * MINUTE;
  assert.ok(h.moods.reaction.until > h.clock);

  h.moods.observe(view({ runs: [job('one')] }));
  assert.equal(h.moods.reaction, null);
});

test('a long turn or a long run is not a quiet room', () => {
  for (const going of [{ busy: true }, { runs: [job('one')] }]) {
    const h = started(view(going));

    h.clock += 20 * MINUTE;
    h.moods.notice();

    assert.equal(h.mood(), undefined);
  }
});

test('a reaction wears off', () => {
  const h = started();
  h.moods.observe(view(report('useful')));

  assert.ok(h.moods.reaction.until > h.clock);
  assert.ok(h.moods.reaction.until - h.clock <= MINUTE);
});

test('only happy and listening step aside for real work, so what the user said and bad news are seen', () => {
  const stepsAside = moment => {
    const h = started();
    h.moods.react(moment);
    return h.moods.reaction.yields;
  };

  assert.equal(stepsAside({ event: 'report', tone: 'useful' }), true);
  assert.equal(stepsAside({ event: 'said', text: 'fix it' }), true);
  for (const moment of [{ event: 'said', text: 'thanks' }, { event: 'said', text: 'this is terrible' }, { event: 'report', tone: 'critical' }, { event: 'merged' }, { event: 'error' }]) {
    assert.equal(stepsAside(moment), false, JSON.stringify(moment));
  }
});

test('once stopped, it reacts to nothing', () => {
  const h = started();

  h.moods.stop();
  h.moods.observe(view(report('useful')));

  assert.equal(h.moods.reaction, null);
});

test('with no reaction the face follows what is going on', () => {
  const now = 1000;
  const states = [
    [{}, 'idle'],
    [{ waiting: true }, 'listening'],
    [{ running: true }, 'working'],
    [{ running: true, waiting: true }, 'working'],
    [{ busy: true }, 'thinking'],
    [{ busy: true, running: true }, 'thinking'],
    [{ busy: true, busyMs: 4 * MINUTE }, 'thinking'],
    [{ busy: true, busyMs: 5 * MINUTE }, 'focused'],
    [{ busy: true, searching: true }, 'searching'],
    [{ busy: true, searching: true, busyMs: 9 * MINUTE }, 'searching'],
    [{ searching: true }, 'idle'],
    [{ busy: true, asked: true }, 'listening'],
    [{ asked: true, reaction: { mood: 'happy', until: 2000 } }, 'listening'],
  ];

  for (const [state, mood] of states) assert.equal(currentMood({ ...state, now }), mood, JSON.stringify(state));
});

test('a search or a read counts as searching, and other tools do not', () => {
  for (const name of ['read', 'grep', 'find', 'ls', 'agentic_search', 'web_search', 'fetch_content']) assert.equal(searchingTool(name), true, name);
  for (const name of ['bash', 'edit', 'write', 'ask_question', undefined, null]) assert.equal(searchingTool(name), false, String(name));
});

test('every mood the face can draw can be reached', () => {
  const reached = new Set();
  const seen = (...views) => {
    const h = started(views[0]);
    for (const next of views.slice(1)) h.moods.observe(next);
    reached.add(h.mood());
  };
  const shown = state => reached.add(currentMood({ now: 1000, ...state }));
  const earlier = ended('zero', 'failed', { stalled: true });

  const opening = new Moods({ now: () => 0 });
  opening.observe(view());
  reached.add(opening.reaction.mood);

  seen(view(), view(said('thanks')));
  seen(view(), view(said('haha')));
  seen(view(), view(said('fix it')));
  seen(view(), view(report('useful')));
  seen(view(), view(report('critical')));
  seen(view(), view(report('blocked')));
  seen(view({ work: { projects: [{ merged: 0 }] } }), view({ work: { projects: [{ merged: 1 }] } }));
  seen(view({ runs: [job('one'), earlier] }), view({ runs: [ended('one', 'failed', { stalled: true }), earlier] }));
  seen(view({ runs: [job('one')] }), view({ runs: [ended('one', 'failed', { stalled: true })] }));
  seen(view({ context: { percent: 1 } }), view({ context: { percent: 99 } }));

  const clarifies = turnThen('Could you clarify?');
  clarifies.finish();
  reached.add(clarifies.mood());

  const quiet = started();
  quiet.clock += 15 * MINUTE;
  quiet.moods.notice();
  reached.add(quiet.mood());

  shown({});
  shown({ busy: true });
  shown({ busy: true, searching: true });
  shown({ busy: true, busyMs: 5 * MINUTE });
  shown({ running: true });

  assert.equal(allMoods.length, 18);
  assert.deepEqual(allMoods.filter(mood => !reached.has(mood)), []);
});
