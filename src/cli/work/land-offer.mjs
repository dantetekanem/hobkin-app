const QUIET_HOURS_MS = 2 * 3600000;
const LONGEST_LABEL = 80;
const NOT_NOW = { value: 'no', label: 'Not now' };

// Titles come from agents, and these go straight to the terminal.
const plain = text => String(text).replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim();

function questionFor(drafts) {
  const [{ title, project }] = drafts;
  const question = drafts.length === 1
    ? `${plain(title)} on ${plain(project)} can land. Walk it now?`
    : `${drafts.length} finished branches can land. Walk them now?`;
  return {
    question,
    choices: [NOT_NOW, { value: 'walk', label: 'Yes, open Done'.slice(0, LONGEST_LABEL) }],
    whenQuiet: true,
  };
}

/**
 * Finished work is no use until someone decides on it, so hobkin brings it up. This takes no model. However many branches finish there is one question,
 * holding all of them, and at most one every two hours, because a question per branch would interrupt more than it helps.
 */
export class LandOffers {
  waiting = [];
  asking = false;
  askedAt = -Infinity;

  constructor({ ask, walk, now = Date.now }) {
    Object.assign(this, { ask, walk, now });
  }

  add(draft) {
    this.waiting.push(draft);
    return this.next();
  }

  /** A question that could not open, which is `undefined`, stays waiting and is asked on the next tick. */
  async next() {
    const tooSoon = this.now() - this.askedAt < QUIET_HOURS_MS;
    if (this.asking || !this.waiting.length || !this.ask || tooSoon) return;

    this.asking = true;
    const drafts = this.waiting.splice(0);
    const answer = await this.ask(questionFor(drafts)).catch(() => null);
    this.asking = false;

    if (answer === undefined) {
      this.waiting.unshift(...drafts);
      return;
    }

    this.askedAt = this.now();
    if (answer === 'walk') this.walk?.();
  }
}
