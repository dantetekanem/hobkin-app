const MOST_DRAFTS_LISTED = 5;
const LONGEST_LABEL = 80;
const NOT_NOW = { value: 'no', label: 'Not now' };

// Titles come from agents, and these go straight to the terminal.
const plain = text => String(text).replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim();

const answerFor = ({ slug, id }) => `${slug}:${id}`;

function questionFor(drafts) {
  const shown = drafts.slice(0, MOST_DRAFTS_LISTED);
  const more = drafts.length - shown.length;
  const inReady = more ? ` ${more} more in READY.` : '';

  if (drafts.length === 1) {
    const [{ title, project }] = drafts;
    return {
      question: `Draft is done: ${plain(title)} on ${plain(project)}. Want to review it?`,
      choices: [NOT_NOW, { value: answerFor(drafts[0]), label: 'Yes, review it' }],
      whenQuiet: true,
    };
  }

  return {
    question: `${drafts.length} drafts are done. Want to review one?${inReady}`,
    choices: [NOT_NOW, ...shown.map(draft => ({
      value: answerFor(draft),
      label: `Review ${plain(draft.project)}: ${plain(draft.title)}`.slice(0, LONGEST_LABEL),
    }))],
    whenQuiet: true,
  };
}

/**
 * A review runs only on the user's word, so a finished draft asks for it. This takes no model. However many drafts finish there is one
 * question at a time, holding all of them, and whatever the answer leaves out stays in READY, where `r` asks for a review at any time.
 */
export class ReviewOffers {
  waiting = [];
  asking = false;

  constructor({ ask, review }) {
    Object.assign(this, { ask, review });
  }

  add(draft) {
    this.waiting.push(draft);
    return this.next();
  }

  /** A question that could not open, which is `undefined`, stays waiting and is asked on the next tick. */
  async next() {
    if (this.asking || !this.waiting.length || !this.ask) return;

    this.asking = true;
    const drafts = this.waiting.splice(0);
    const answer = await this.ask(questionFor(drafts)).catch(() => null);
    this.asking = false;

    if (answer === undefined) {
      this.waiting.unshift(...drafts);
      return;
    }

    const chosen = drafts.find(draft => answerFor(draft) === answer);
    // The item may have started again since it was asked about. It is still in READY or the queue, so nothing is lost.
    if (chosen) await this.review(chosen).catch(() => {});
    await this.next();
  }
}
