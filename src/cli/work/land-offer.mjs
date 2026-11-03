import { learningEnabled } from '../config.mjs';
import { answerDecision, openDecisions } from '../decisions.mjs';
import { weighedRows } from './reads.mjs';
import { paths, readItems, readJson } from './store.mjs';
import { readUnmerged } from './unmerged.mjs';

const QUIET_HOURS_MS = 2 * 3600000;
// A survey comes round every half hour, so a new branch waits this long at most to be weighed before it gets the plain question.
const SURVEY_WAIT_MS = 3600000;
const MOST_ALIKE = 5;
// Below this hobkin can see a change go live but not whether it works.
const SEES_IT_WORKING = 2;

// Titles come from agents, and these reach the terminal.
const plain = text => String(text).replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim();
const sentence = text => (/[.!?]$/.test(text) ? text : `${text}.`);

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

const dayWords = at => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const gradeWords = ({ safety, onlyDocs }) => (onlyDocs ? 'docs only' : `${plain(safety.grade)} ${plain(safety.rating)}`);
const linesIn = ({ size }) => size.additions + size.deletions;
const lineWords = lines => `${lines} ${lines === 1 ? 'line' : 'lines'}`;

function watchWords({ outcome, days }) {
  if (outcome === 'held') return days ? `Its watch closed after ${days} ${days === 1 ? 'day' : 'days'}, nothing new.` : 'Its watch closed, nothing new.';
  if (outcome === 'quiet') return 'That project could not show how it went, and nothing went wrong.';
  if (outcome === 'unexercised') return 'Nothing reached it during its watch.';
  return 'It is still in its watch.';
}

function tallyWords({ merged, held, quiet, unexercised, watching }) {
  const parts = [held && `${held} held`, quiet && `${quiet} quiet`, unexercised && `${unexercised} unexercised`, watching && `${watching} still in a watch`];
  return `${merged} merged like it: ${parts.filter(Boolean).join(', ')}.`;
}

function precedentLine(precedent, slug) {
  const { latest, merged } = precedent;
  const where = precedent.slug === slug ? '' : ` on ${plain(precedent.slug)}`;
  const like = `Like "${plain(latest.title)}"${where}, merged ${dayWords(latest.at)}.`;
  return [like, watchWords(latest), merged > 1 && tallyWords(precedent)].filter(Boolean).join(' ');
}

const riskWords = ({ launch }) => sentence(plain(launch?.risk ?? 'The review named none'));

const blindLine = (project, signal) => (signal >= SEES_IT_WORKING ? null : `hobkin cannot see requests or runs on ${plain(project)}, so it will not see how this goes.`);

const offerKey = (slug, item) => `offer:${slug}:${item}`;

const offerChoices = (merge, read, no) => [{ value: 'later', label: 'Later' }, { value: 'merge', label: merge }, { value: 'read', label: read }, { value: 'no', label: no }];

function singleOffer({ row: { slug, item: id, project, title }, item, unit, offer }, signal) {
  return {
    key: offerKey(slug, id),
    from: 'Work mode',
    question: [
      `${plain(project)}: ${plain(title)} · ${gradeWords(unit)} · ${lineWords(linesIn(unit))}`,
      precedentLine(offer.precedent, slug),
      `Risk: ${riskWords(item)}`,
      item.launch?.how && `Undo: ${sentence(plain(item.launch.how))}`,
      blindLine(project, signal),
    ].filter(Boolean).join('\n'),
    tldr: `${plain(project)}: ${plain(title)}`,
    choices: offerChoices('Merge it', 'Read it', 'Not this one'),
    answerTo: { kind: 'merge', slug, item: id, head: unit.sha },
  };
}

/** Several alike on one key. Answering merges them in order, safest and smallest first, and the first failure stops there with the rest left as they are. */
function sharedOffer(entries, signal) {
  const [{ row: { slug, item: id, project }, unit, offer }, ...others] = entries;
  const lines = entries.reduce((sum, entry) => sum + linesIn(entry.unit), 0);
  return {
    key: offerKey(slug, id),
    from: 'Work mode',
    question: [
      `${plain(project)}: ${entries.length} alike · ${gradeWords(unit)} · ${lineWords(lines)}`,
      precedentLine(offer.precedent, slug),
      ...entries.map(({ row, item }) => `- ${plain(row.title)}. Risk: ${riskWords(item)}`),
      blindLine(project, signal),
    ].filter(Boolean).join('\n'),
    tldr: `${plain(project)}: ${entries.length} alike can land`,
    choices: offerChoices(`Merge all ${entries.length}`, 'Read them', 'Not these'),
    answerTo: { kind: 'merge', slug, item: id, head: unit.sha, also: others.map(entry => ({ item: entry.row.item, head: entry.unit.sha })) },
  };
}

function alike(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const { offer: { tier, pattern }, row: { item } } = entry;
    const key = tier === 'earned' ? pattern : item;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()].map(group => group.slice(0, MOST_ALIKE));
}

/** Every item one merge decision covers, with the commit it was asked about. */
export const offeredIn = ({ item, head, also = [] }) => [{ item, head }, ...also];

const askedNow = root => new Set(openDecisions(root).flatMap(({ answerTo }) => (answerTo?.kind === 'merge' ? offeredIn(answerTo).map(({ item }) => `${answerTo.slug}:${item}`) : [])));

const isHeld = ({ offerHeldUntil }, now) => Date.parse(offerHeldUntil ?? '') > now;

const signalOf = (root, slug) => readJson(paths(root, slug).signals, {}).signal ?? 0;

/** What could be offered now, best first, leaving out what is already asked or held. With learning off nothing is judged, so only the plain question goes. */
export function offerDecisions(root, now = Date.now()) {
  if (!learningEnabled(root)) return [];
  const asked = askedNow(root);
  const offered = weighedRows(root, now).filter(({ row, item, offer }) => offer?.offerable && !asked.has(`${row.slug}:${row.item}`) && !isHeld(item, now));
  return alike(offered).map(group => {
    const signal = signalOf(root, group[0].row.slug);
    return group.length > 1 ? sharedOffer(group, signal) : singleOffer(group[0], signal);
  });
}

/** An offer whose work has left the list has nothing to ask, so it should not sit there adding to what is waiting. */
export function retireOffers(root, now = Date.now()) {
  for (const { id, answerTo } of openDecisions(root)) {
    if (answerTo?.kind !== 'merge') continue;
    const items = readItems(root, answerTo.slug);
    const waiting = offeredIn(answerTo).some(({ item }) => items.find(entry => entry.id === item)?.state === 'branch');
    if (!waiting) answerDecision(root, id, 'later', now);
  }
}

/** A branch the survey has not read cannot be weighed yet, and the plain question now would only mean asking again once it can. */
export function notSurveyed(root, { slug, id }) {
  if (!learningEnabled(root)) return false;
  const branch = readItems(root, slug).find(item => item.id === id)?.branch;
  return !(readUnmerged(root).projects[slug]?.open ?? []).some(unit => unit.branch === branch);
}

const offerRow = ({ row: { slug, project, item, title }, offer: { pattern, tier, spot, why, precedent } }) => ({
  slug,
  project,
  item,
  title,
  pattern,
  tier,
  spot,
  why,
  precedent: precedent && { merged: precedent.merged, held: precedent.held, quiet: precedent.quiet, unexercised: precedent.unexercised, watching: precedent.watching, weight: precedent.weight, from: precedent.slug },
});

/** `hobkin work offers`: what qualifies and why the rest does not, reading only. */
export function offersView(root, now = Date.now()) {
  if (!learningEnabled(root)) return { learning: false, offers: [], rest: [] };
  const rows = weighedRows(root, now).filter(({ row }) => row.gap !== 'yours');
  return {
    learning: true,
    offers: rows.filter(({ offer }) => offer.offerable).map(offerRow),
    rest: rows.filter(({ offer }) => !offer.offerable).map(offerRow),
  };
}

/**
 * Finished work is no use until someone decides on it, so hobkin brings it up. This takes no model. Branches that finish together are one
 * decision, and a new one comes at most every two hours, because a question per branch would interrupt more than it helps. What qualifies
 * goes first, as an offer to land it on one key. The rest get the plain question.
 */
export class LandOffers {
  waiting = [];
  filedAt = -Infinity;

  constructor({ file, now = Date.now, offers = () => [], unread = () => false }) {
    Object.assign(this, { file, now, offers, unread });
  }

  add(draft) {
    this.waiting.push({ ...draft, addedAt: this.now() });
    this.next();
  }

  plainQuestion() {
    const drafts = this.waiting.filter(draft => !this.unread(draft) || this.now() - draft.addedAt >= SURVEY_WAIT_MS);
    this.waiting = this.waiting.filter(draft => !drafts.includes(draft));
    return drafts.length ? landDecision(drafts, drafts.length) : null;
  }

  fileOffer(offer) {
    this.waiting = this.waiting.filter(({ slug, id }) => slug !== offer.answerTo.slug || !offeredIn(offer.answerTo).some(({ item }) => item === id));
    this.file(offer);
    this.filedAt = this.now();
  }

  next() {
    if (!this.file || this.now() - this.filedAt < QUIET_HOURS_MS) return;
    const [offer] = this.offers();
    if (offer) {
      this.fileOffer(offer);
      return;
    }
    const question = this.plainQuestion();
    if (!question) return;
    this.file(question);
    this.filedAt = this.now();
  }

  /** The user asked for what is ready, so this comes now, whatever the quiet gap says. With nothing to offer it says so, and they go to Done instead. */
  offerReady() {
    const [offer] = this.file ? this.offers() : [];
    if (offer) this.fileOffer(offer);
    return Boolean(offer);
  }
}
