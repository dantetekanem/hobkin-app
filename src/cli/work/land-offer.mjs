const QUIET_HOURS_MS = 2 * 3600000;

// Titles come from agents, and these reach the terminal.
const plain = text => String(text).replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim();

const questionFor = drafts => {
  const [{ title, project }] = drafts;
  return drafts.length === 1 ? `${plain(title)} on ${plain(project)} can land. Walk it now?` : `${drafts.length} finished branches can land. Walk them now?`;
};

const landDecision = (drafts, count) => ({
  key: 'land',
  from: 'Work mode',
  question: questionFor(drafts),
  tldr: `${count} finished ${count === 1 ? 'branch' : 'branches'} can land`,
  choices: [{ value: 'later', label: 'Later' }, { value: 'walk', label: 'Yes, open Done' }],
  answerTo: { kind: 'land' },
});

/**
 * Finished work is no use until someone decides on it, so hobkin brings it up. This takes no model. Branches that finish together are one
 * decision, and a new one comes at most every two hours, because a question per branch would interrupt more than it helps.
 */
export class LandOffers {
  waiting = [];
  filedAt = -Infinity;

  constructor({ file, now = Date.now }) {
    Object.assign(this, { file, now });
  }

  add(draft) {
    this.waiting.push(draft);
    this.next();
  }

  next() {
    if (!this.waiting.length || !this.file || this.now() - this.filedAt < QUIET_HOURS_MS) return;
    const drafts = this.waiting.splice(0);
    this.file(landDecision(drafts, drafts.length));
    this.filedAt = this.now();
  }
}
