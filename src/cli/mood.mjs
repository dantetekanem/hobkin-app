import { FORCE_AT_PERCENT } from './compaction.mjs';
import { saysBadWork } from './learning/judge.mjs';

const REACTION_MS = 30000;
const QUIET_MS = 15 * 60000;
const LONG_TURN_MS = 5 * 60000;
const CROWDED_AT = 4;
const REPLY_ENDING_LENGTH = 300;
const LIMIT_PAUSES = ['day', 'hour', 'usage'];
// Busy starts the moment a message is sent, so these two are the only reactions a turn may hide. Bad news and what the user said stay in sight.
const YIELDING = ['happy', 'listening'];
const CHEERFUL = ['happy', 'love'];
const COMPLAINT = 'user said the work is bad';

const HELLO = /^(?:hi|hello|hey|hiya|yo|good (?:morning|afternoon|evening)|oi|ola|opa|e ai|eai|bom dia|boa tarde|boa noite)\b.{0,24}$/;
const KIND = /(?<!\bno )\bthanks\b|\b(?:thank you|thx|cheers|appreciate it|love you|love it|well done|(?:good|great|nice) (?:job|work)|you rock|obrigad[oa]|brigad[oa]|valeu|muito bom|mandou bem|(?:bom|otimo) trabalho|parabens|te amo|amei)\b/;
const JOKE = /\b(?:(?:ha){2,}h?|(?:he){2,}h?|(?:hue){2,}|k{3,}|(?:rs){2,}|lol|lmao|rofl)\b|(?:^|\s)(?:[:;]-?[)dp]|xd)(?=\s|$)/;
const CLARIFY = /\b(?:clarify|what do you mean|did you mean|do you mean|which (?:one|of these) do you|not sure what you|be more specific|esclarecer|quer dizer|quis dizer|explicar melhor|ser mais especifico|nao entendi)\b/;
const ENDS_ASKING = /\?[*_`)"'\s]*$/;
const SEARCH_TOOL = /read|grep|find|glob|search|fetch|^ls$/i;

const plain = text => String(text ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
const replyEnding = ({ text }) => plain(text).slice(-REPLY_ENDING_LENGTH);

export const searchingTool = name => SEARCH_TOOL.test(name ?? '');

const happened = name => ({ event }) => event === name;
const userSaid = pattern => ({ event, text }) => event === 'said' && pattern.test(plain(text));
const reportWas = wanted => ({ event, tone }) => event === 'report' && tone === wanted;
const runEnded = wanted => ({ event, status }) => event === 'run' && status === wanted;
const turnEnded = reading => moment => moment.event === 'turn' && reading(moment);
const cleanTurn = reading => turnEnded(moment => moment.status === 'completed' && reading(moment));

/**
 * From a moment to a mood, with no network, no model and nothing kept. First match wins, so what a message or a reply says is read here and goes
 * no further. Moods that only describe what is going on are in `shownMood`, and a moment that matches nothing leaves the face alone.
 */
const CHANGED_UNDER = /moved since|already|so there is no|no longer|is (?:merged|done|declined|dropped)\b/i;
const failedWith = pattern => ({ event, text }) => event === 'answer failed' && pattern.test(String(text ?? ''));
const cardDid = reading => ({ event, did }) => event === 'card' && reading(String(did ?? ''));

const RULES = [
  ['hello', 'session started', happened('session')],
  ['love', 'the user decided everything waiting', happened('all decided')],
  ['wink', 'the user answered at once', happened('quick answer')],
  ['sad', 'the user said no to work', cardDid(did => did === 'said no')],
  ['celebrating', 'the user merged work', cardDid(did => /\bmerged\b/.test(did))],
  ['grumpy', 'a merge hit a conflict', failedWith(/conflict/i)],
  ['confused', 'the work changed under the answer', failedWith(CHANGED_UNDER)],
  ['error', 'an answer failed', happened('answer failed')],
  ['sad', COMPLAINT, ({ event, text }) => event === 'said' && saysBadWork(text)],
  ['hello', 'user said hello', userSaid(HELLO)],
  ['love', 'user said something kind', userSaid(KIND)],
  ['wink', 'user joked', userSaid(JOKE)],
  ['listening', 'user sent a message', happened('said')],
  ['listening', 'a decision was filed', happened('decision')],
  ['confused', 'unknown command', happened('unknown command')],
  ['error', 'an error reached the screen', happened('error')],
  ['error', 'main turn failed', turnEnded(({ status, stopReason }) => status === 'failed' || stopReason === 'error')],
  ['surprised', 'main turn stopped by itself', turnEnded(({ status }) => status === 'incomplete')],
  ['confused', 'reply asked them to clarify', cleanTurn(moment => CLARIFY.test(replyEnding(moment)))],
  ['listening', 'reply ended by asking', cleanTurn(moment => ENDS_ASKING.test(replyEnding(moment)))],
  ['happy', 'long turn finished', cleanTurn(({ ms }) => ms >= LONG_TURN_MS)],
  ['grumpy', 'the same work stalled twice', ({ event, stalled, twice }) => event === 'run' && stalled && twice],
  ['error', 'run failed', runEnded('failed')],
  ['surprised', 'run stopped by itself', runEnded('interrupted')],
  ['sad', 'run reported a failure', ({ event, stalled }) => event === 'run' && stalled],
  ['happy', 'useful report', reportWas('useful')],
  ['surprised', 'critical report', reportWas('critical')],
  ['sad', 'blocked report', reportWas('blocked')],
  ['celebrating', 'a merge landed', happened('merged')],
  ['dizzy', 'four or more things running', happened('crowded')],
  ['dizzy', 'context nearly full', happened('context')],
  ['dizzy', 'work paused on a limit', happened('limit')],
  ['sleepy', 'fifteen quiet minutes', happened('quiet')],
];

export function moodFor(moment) {
  const rule = RULES.find(([, , matches]) => matches(moment));
  return rule ? { mood: rule[0], cause: rule[1] } : null;
}

/**
 * What the face shows on a frame and why: a reaction while it lasts, and otherwise whatever is going on. In a turn the face follows what the
 * agent does: searching while it reads, working while it runs any other tool, and thinking, or focused after five minutes, while it writes.
 */
export function shownMood({ reaction, busy, running, typing, now, asked, waiting, searching, tooling, busyMs = 0 }) {
  // A face that went quiet with the room wakes for whoever starts typing, and waits to hear what they want.
  if (reaction?.lasting && typing) return { mood: 'listening', cause: 'user is typing' };
  if (asked) return { mood: 'listening', cause: 'a question is on screen' };
  const stepsAside = reaction?.yields && (busy || running);
  if (reaction && now < reaction.until && !stepsAside) return reaction;
  if (busy && searching) return { mood: 'searching', cause: 'turn is searching or reading' };
  if (busy && tooling) return { mood: 'working', cause: 'turn is running a tool' };
  if (busy && busyMs >= LONG_TURN_MS) return { mood: 'focused', cause: 'turn over five minutes' };
  if (busy) return { mood: 'thinking', cause: 'turn under way' };
  if (typing) return { mood: 'listening', cause: 'user is typing' };
  if (running) return { mood: 'working', cause: 'a run is going' };
  return waiting ? { mood: 'listening', cause: 'a decision is waiting' } : { mood: 'idle', cause: 'nothing going on' };
}

export const currentMood = state => shownMood(state).mood;

const stateOf = view => {
  const messages = view.messages ?? [];
  const runs = view.runs ?? [];
  const latest = role => messages.findLast(message => message.role === role);
  return {
    report: messages.findLast(message => message.id?.startsWith('notice:report:')),
    user: latest('user'),
    agent: latest('assistant'),
    busy: Boolean(view.busy),
    turn: runs.find(run => run.kind === 'main' && run.title === 'Conversation'),
    runs,
    running: runs.filter(run => run.state === 'running' && run.kind === 'background').map(run => run.id),
    limit: LIMIT_PAUSES.includes(view.work?.pause?.kind),
    error: view.error ?? null,
    contextFull: view.context?.percent >= FORCE_AT_PERCENT,
    decisions: (view.decisions ?? []).length,
    waiting: (view.decisions ?? []).length + Object.values(view.waiting ?? {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0),
    merged: (view.work?.projects ?? []).reduce((sum, { merged = 0 }) => sum + merged, 0),
  };
};

const subjectOf = run => run.work?.item ?? run.scheduleId;
const crowded = ({ running, busy }) => running.length + (busy ? 1 : 0) >= CROWDED_AT;

/** Runs come newest first. A run that was stopped says nothing about the work, so it neither ends a streak nor adds to one. */
function stalledBefore(run, runs) {
  const same = runs.filter(other => subjectOf(other) === subjectOf(run) && !['running', 'interrupted'].includes(other.state));
  return Boolean(same[same.indexOf(run) + 1]?.stalled);
}

const runMoment = (run, runs) => ({ event: 'run', status: run.state, stalled: run.stalled, twice: stalledBefore(run, runs) });
const turnMoment = ({ turn, agent }, ms) => ({ event: 'turn', status: turn?.state, stopReason: turn?.stopReason, text: agent?.content, ms });

function whatHappened(before, now, turnMs) {
  const ended = now.runs.filter(run => before.running.includes(run.id) && run.state !== 'running');
  const stopped = ended.find(run => run.stalled || run.state === 'interrupted');
  if (now.error && now.error !== before.error) return { event: 'error' };
  if (stopped) return runMoment(stopped, now.runs);
  if (now.report && now.report.id !== before.report?.id) return { event: 'report', tone: now.report.tone };
  if (now.merged > before.merged) return { event: 'merged' };
  if (now.limit && !before.limit) return { event: 'limit' };
  if (before.busy && !now.busy) return turnMoment(now, turnMs);
  if (now.user && now.user.id !== before.user?.id) return { event: 'said', text: now.user.content };
  if (crowded(now) && !crowded(before)) return { event: 'crowded' };
  if (now.contextFull && !before.contextFull) return { event: 'context' };
  if (now.decisions > before.decisions) return { event: 'decision' };
  if (before.waiting > 0 && now.waiting === 0) return { event: 'all decided' };
  if (now.running.some(id => !before.running.includes(id))) return { event: 'run started' };
  return ended.length ? runMoment(ended[0], now.runs) : null;
}

/** Turns what happens in the app into the face's reactions. */
export class Moods {
  reaction = null;

  constructor({ now = Date.now, onChange = () => {} } = {}) {
    Object.assign(this, { now, onChange });
    this.seen = null;
    this.lastMomentAt = now();
    this.turnStartedAt = now();
    this.quiet = false;
    this.scolded = false;
    this.stopped = false;
  }

  observe(view) {
    const state = stateOf(view);
    const moment = this.seen ? whatHappened(this.seen, state, this.now() - this.turnStartedAt) : { event: 'session' };
    if (state.busy && !this.seen?.busy) this.turnStartedAt = this.now();
    this.seen = state;
    if (moment) this.react(moment);
  }

  /** Called on the clock, because nothing else happens when nothing happens. A long turn or a long run is not a quiet room. */
  notice() {
    const going = this.seen?.busy || this.seen?.running.length;
    if (this.quiet || going || this.now() - this.lastMomentAt < QUIET_MS) return;
    this.quiet = true;
    this.react({ event: 'quiet' });
  }

  react(moment) {
    if (this.stopped) return;
    this.lastMomentAt = this.now();
    if (moment.event !== 'quiet') {
      this.quiet = false;
      if (this.reaction?.lasting) this.reaction = null;
    }
    const chosen = moodFor(moment);
    if (!chosen) return;

    // Told the work is bad, the face does not cheer up at the very next thing.
    const heldBack = this.scolded && CHEERFUL.includes(chosen.mood);
    this.scolded = chosen.cause === COMPLAINT;
    if (!heldBack) this.show(chosen);
  }

  show({ mood, cause }) {
    const lasting = mood === 'sleepy';
    this.reaction = {
      mood,
      cause,
      lasting,
      yields: YIELDING.includes(mood),
      until: lasting ? Number.MAX_SAFE_INTEGER : this.now() + REACTION_MS,
    };
    this.onChange();
  }

  stop() {
    this.stopped = true;
  }
}
