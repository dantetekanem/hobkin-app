// What the face does when the user wakes it, pokes it or keeps passing the pointer over it. Each reaction is a few of the face's own moods,
// so the drawn face and its pictures both have them, and each ends by the clock. Only a wake says anything to the app: that the sleep is over.

// Drowsy, a stretch, then awake.
const WAKING = [
  { mood: 'focused', ms: 1000 },
  { mood: 'happy', ms: 900 },
  { mood: 'hello', ms: 1100 },
];
// Startled, then amused, then annoyed, while each poke comes soon after the last.
const POKED = ['surprised', 'wink', 'happy', 'grumpy'];
const POKE_MS = 1400;
const POKE_STREAK_MS = 2500;
const RUBBED = [{ mood: 'dizzy', ms: 2400 }];
const RUB_PASSES = 5;
const RUB_WINDOW_MS = 4000;

export class FaceReactions {
  playing = null;
  wokeFrom = null;
  pokeStreak = 0;
  lastPokeAt = -Infinity;
  passTimes = [];
  pointerOnFace = false;

  constructor({ now = Date.now, reaction = () => null, onWake = () => {} } = {}) {
    this.now = now;
    this.appReaction = reaction;
    this.onWake = onWake;
  }

  /** The app's reaction as the face takes it: the sleep it woke from is over before the app hears so. */
  current() {
    const reaction = this.appReaction();
    return reaction && reaction === this.wokeFrom ? null : reaction;
  }

  asleep() {
    return Boolean(this.current()?.lasting);
  }

  waking() {
    return Boolean(this.playing?.waking && this.shown());
  }

  /** Plays the waking up and tells the app the sleep is over. True when there was a sleep to end. */
  wake() {
    if (!this.asleep()) return false;

    this.wokeFrom = this.appReaction();
    this.play(WAKING, { waking: true });
    this.onWake();
    return true;
  }

  /** Wakes a sleeping face, and otherwise pokes it. A poke also starts the passes over, so poking and rubbing stay apart. */
  click() {
    if (this.wake() || this.waking()) return;

    const at = this.now();
    const onStreak = at - this.lastPokeAt < POKE_STREAK_MS;
    this.pokeStreak = onStreak ? this.pokeStreak + 1 : 1;
    this.lastPokeAt = at;
    this.passTimes = [];

    const mood = POKED[Math.min(this.pokeStreak, POKED.length) - 1];
    this.play([{ mood, ms: POKE_MS }]);
  }

  /** Counts each time the pointer comes onto the face. True when that starts a reaction. */
  hover(inside) {
    const entered = inside && !this.pointerOnFace;
    this.pointerOnFace = inside;
    if (!entered || this.asleep() || this.waking()) return false;

    const at = this.now();
    const recent = this.passTimes.filter(passedAt => at - passedAt < RUB_WINDOW_MS);
    this.passTimes = [...recent, at];
    if (this.passTimes.length < RUB_PASSES) return false;

    this.passTimes = [];
    this.play(RUBBED);
    return true;
  }

  play(steps, { waking = false } = {}) {
    this.playing = { steps, waking, since: this.now() };
  }

  /** The mood to draw in place of the usual one and how far into it, so it starts at its own beginning. Null when nothing is playing. */
  shown(at = this.now()) {
    if (!this.playing) return null;

    let start = this.playing.since;
    for (const { mood, ms } of this.playing.steps) {
      if (at < start + ms) return { mood, ms: at - start };
      start += ms;
    }
    return null;
  }
}
