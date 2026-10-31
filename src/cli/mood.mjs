import { moods } from './face.mjs';

const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-latest';
const JEV_TIMEOUT_MS = 8000;
const REACTION_MS = 30000;
const MIN_GAP_MS = 5000;
const QUIET_MS = 15 * 60000;
const MAX_QUOTE_LENGTH = 400;

const MOOD_QUESTION = 'Hobkin is a small hooded helper shown beside the input box of a terminal assistant. Given `event` and what was just said, which expression should Hobkin show right now?';
const MOOD_MEANINGS = {
  idle: 'Nothing is happening and Hobkin is waiting for the user.',
  hello: 'A session just started, or the user said hello.',
  listening: 'The user is asking for something, or Hobkin needs the user\'s reply.',
  thinking: 'The agent is planning or reasoning about the next step.',
  searching: 'The agent is searching code, files, notes or the web.',
  working: 'The agent, a scheduled check or work mode is busy doing the work.',
  focused: 'A long, demanding task is under way.',
  happy: 'Something finished well: a good report, passing tests, a job done.',
  celebrating: 'A real win: something shipped, merged, or a big milestone.',
  love: 'The user said thank you or something kind.',
  wink: 'A clever shortcut, a small joke, or something playful.',
  surprised: 'Something unexpected came up.',
  confused: 'The request is unclear and needs clarifying.',
  sad: 'Bad news: something failed or a report found a problem.',
  grumpy: 'The same problem keeps coming back, such as a flaky test or a repeated failure.',
  error: 'A command, check or agent blew up.',
  dizzy: 'Too much at once: context is nearly full, or many things are running.',
  sleepy: 'It has been quiet for a long time.',
};

/** What the app can show from its own state. Every other mood needs Jev to read the moment. */
export const defaultMoods = ['idle', 'thinking', 'working', 'happy'];

export function currentMood({ reaction, busy, running, now }) {
  const stepsAside = reaction?.yields && (busy || running);
  if (reaction && now < reaction.until && !stepsAside) return reaction.mood;
  if (busy) return 'thinking';
  return running ? 'working' : 'idle';
}

export async function askJev(state, { key = process.env.TYPESAFE_API_KEY, request = fetch } = {}) {
  if (!key) throw Error('Jev needs TYPESAFE_API_KEY.');
  const response = await request(JEV_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: JEV_MODEL,
      state,
      questions: { mood: { type: 'choice', instructions: MOOD_QUESTION, criteria: MOOD_MEANINGS } },
    }),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });
  if (!response.ok) throw Error(`Jev answered ${response.status}.`);
  return (await response.json()).answers?.mood?.choice;
}

const quoted = message => (message ? String(message.content).slice(-MAX_QUOTE_LENGTH) : undefined);

const stateOf = view => {
  const messages = view.messages ?? [];
  const latest = role => messages.findLast(message => message.role === role);
  return {
    // A request for more tokens is a notice too, but the pause below is what happened.
    notice: messages.findLast(message => message.role === 'notice' && !message.id.startsWith('notice:work-allowance:')),
    user: latest('user'),
    agent: latest('assistant'),
    busy: Boolean(view.busy),
    paused: Boolean(view.work?.paused),
    running: (view.runs ?? []).filter(run => run.state === 'running' && run.kind === 'background').map(run => run.title),
  };
};

const whatHappened = (before, now) => {
  if (now.notice && now.notice.id !== before.notice?.id) {
    return { event: 'A report just arrived', outcome: now.notice.tone ?? 'ordinary', report: quoted(now.notice) };
  }
  if (now.paused && !before.paused) return { event: 'Work mode paused at its token limit' };
  if (before.busy && !now.busy) return { event: 'The main agent just finished replying' };
  if (now.user && now.user.id !== before.user?.id) return { event: 'The user just sent a message' };
  const started = now.running.filter(title => !before.running.includes(title));
  if (started.length) return { event: `Now running: ${started.join(', ')}` };
  if (now.running.length < before.running.length) return { event: 'A check or work agent just finished' };
  return null;
};

/** Turns what happens in the app into the face's reactions. With Jev on, Jev reads each moment and may pick any mood. */
export class Moods {
  reaction = null;

  constructor({ enabled = () => false, ask = askJev, now = Date.now, onChange = () => {} } = {}) {
    Object.assign(this, { enabled, ask, now, onChange });
    this.seen = null;
    this.waiting = null;
    this.asking = false;
    this.timer = null;
    this.askedAt = -Infinity;
    this.lastMomentAt = now();
    this.quiet = false;
    this.stopped = false;
  }

  observe(view) {
    const state = stateOf(view);
    const moment = this.seen ? whatHappened(this.seen, state) : { event: 'A session just started' };
    this.seen = state;
    if (moment) this.react(moment);
  }

  /** Called on the clock, because nothing else happens when nothing happens. */
  notice() {
    if (this.quiet || this.now() - this.lastMomentAt < QUIET_MS) return;
    this.quiet = true;
    if (this.enabled()) this.react({ event: 'It has been quiet for a long time', lasting: true });
  }

  react(moment) {
    if (this.stopped) return;
    this.lastMomentAt = this.now();
    if (!moment.lasting) {
      this.quiet = false;
      if (this.reaction?.lasting) this.reaction = null;
    }
    if (!this.enabled()) {
      this.showDefault(moment);
      return;
    }
    this.waiting = moment;
    this.askNext();
  }

  showDefault({ outcome }) {
    if (outcome === 'useful') this.show('happy', { yields: true });
  }

  show(mood, { lasting = false, yields = false } = {}) {
    this.reaction = { mood, lasting, yields, until: lasting ? Number.MAX_SAFE_INTEGER : this.now() + REACTION_MS };
    this.onChange();
  }

  askNext() {
    // A moment can wait a few seconds, and by then the user may have turned Jev off.
    if (this.stopped || !this.enabled()) {
      this.waiting = null;
      return;
    }
    if (this.asking || this.timer || !this.waiting) return;
    const wait = this.askedAt + MIN_GAP_MS - this.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.askNext();
      }, wait);
      this.timer.unref?.();
      return;
    }
    const moment = this.waiting;
    this.waiting = null;
    this.asking = true;
    this.askedAt = this.now();
    const { lasting, ...details } = moment;
    const state = { ...details, userSaid: quoted(this.seen?.user), agentSaid: quoted(this.seen?.agent), running: this.seen?.running };
    this.ask(state).then(mood => {
      if (this.stopped || (lasting && !this.quiet)) return;
      if (moods.includes(mood)) this.show(mood, { lasting });
      else this.showDefault(moment);
    }, () => {
      if (!this.stopped) this.showDefault(moment);
    }).finally(() => {
      this.asking = false;
      this.askNext();
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.waiting = null;
  }
}
