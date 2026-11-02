const REACTION_MS = 30000;
export function currentMood({ reaction, busy, running, typing, now }) {
  // A face that went quiet with the room wakes for whoever starts typing, and waits to hear what they want.
  if (reaction?.lasting && typing) return 'listening';
  const stepsAside = reaction?.yields && (busy || running);
  if (reaction && now < reaction.until && !stepsAside) return reaction.mood;
  if (busy) return 'thinking';
  return running ? 'working' : 'idle';
}

const stateOf = view => ({
  // A request for more tokens is a notice too, but it says nothing about a report.
  notice: (view.messages ?? []).findLast(message => message.role === 'notice' && !message.id.startsWith('notice:work-allowance:')),
});

const whatHappened = (before, now) => {
  if (now.notice && now.notice.id !== before.notice?.id) return { outcome: now.notice.tone };
  return null;
};

/** Turns what happens in the app into the face's reactions. */
export class Moods {
  reaction = null;

  constructor({ now = Date.now, onChange = () => {} } = {}) {
    Object.assign(this, { now, onChange });
    this.seen = null;
    this.stopped = false;
  }

  observe(view) {
    const state = stateOf(view);
    const moment = this.seen ? whatHappened(this.seen, state) : null;
    this.seen = state;
    if (moment?.outcome === 'useful') this.show('happy');
  }

  /** Called on the clock, because nothing else happens when nothing happens. */
  notice() {}

  show(mood) {
    if (this.stopped) return;
    this.reaction = { mood, lasting: false, yields: true, until: this.now() + REACTION_MS };
    this.onChange();
  }

  stop() {
    this.stopped = true;
  }
}
