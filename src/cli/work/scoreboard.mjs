import { readItems, readProjects } from './store.mjs';

const QUICK_MS = 3000;
// The card stands for what is on it, so counting it would count those twice.
const CARD = 'pending';
const REQUEST_SOURCES = ['work-allowance', 'learning'];
const CLEAN_OUTCOMES = ['held', 'quiet'];
const NO_EVENTS = 'No events yet, so there is nothing to score.';

const counted = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function listed(parts) {
  const words = parts.filter(Boolean);
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

const landedOn = (root, slug) => readItems(root, slug).flatMap(({ landed }) => (landed ? [{ ...landed, slug }] : []));

/** Every project ever chosen, because one dropped since still merged what it merged. */
export const landedRecords = root => readProjects(root).flatMap(({ slug }) => landedOn(root, slug));

// A branch brings along what it was built on, and all of it shares the merge's commit. A merge on the remote says nothing about what was read.
function mergeTotals(landed) {
  const here = landed.filter(({ route }) => route !== 'remote');
  const merges = [...new Map(here.map(record => [`${record.slug}:${record.sha}`, record])).values()];
  const page = merges.filter(({ read }) => read === 'page').length;
  const diff = merges.filter(({ read }) => read === 'diff').length;
  return {
    total: merges.length,
    opened: page + diff,
    page,
    diff,
    remote: landed.length - here.length,
  };
}

function broughtLine({ brought: { decisions, reports, requests }, acted }) {
  const asked = listed([
    decisions && counted(decisions, 'decision', 'decisions'),
    reports && counted(reports, 'report with a next step', 'reports with a next step'),
    requests && counted(requests, 'request', 'requests'),
  ]);
  const did = listed([
    acted.answered && `answered ${acted.answered}`,
    acted.opened && `opened ${acted.opened}`,
    acted.merged && `merged ${acted.merged}`,
    acted.declined && `said no to ${acted.declined}`,
    acted.sentBack && `sent ${acted.sentBack} back`,
  ]);
  const answer = did ? `You ${did}.` : asked && 'You acted on none of it.';
  return [`Brought you ${asked || 'nothing to decide'}.`, answer].filter(Boolean).join(' ');
}

const attentionLine = ({ answers, merges }) => [
  answers.total && `${answers.under3s} of ${counted(answers.total, 'answer', 'answers')} came in under 3 seconds.`,
  merges.total && `${merges.opened} of ${counted(merges.total, 'merge', 'merges')} had the page or diff opened.`,
].filter(Boolean).join(' ');

function settledLine({ settled: { recalled, nothingNew, watchesClosed, harnessFixes } }) {
  const alone = listed([
    recalled && counted(recalled, 'recalled answer', 'recalled answers'),
    nothingNew && counted(nothingNew, 'check with nothing new', 'checks with nothing new'),
    watchesClosed && counted(watchesClosed, 'watch closed clean', 'watches closed clean'),
    harnessFixes && counted(harnessFixes, 'fix filed on itself', 'fixes filed on itself'),
  ]);
  return alone && `Settled alone: ${alone}.`;
}

/**
 * What hobkin brought, what came of it and what it settled alone. The fight is working when calls fall and the share read stays up.
 * Only sums over what was recorded, so anything it has no record of gets no line. A decision answered on screen counts its seconds there, and one in the tab how long it was open.
 */
export function scoreboard(events, landed) {
  const ofType = (...types) => events.filter(({ type }) => types.includes(type));
  const count = type => ofType(type).length;
  const notTheCard = type => ofType(type).filter(({ source }) => source !== CARD).length;
  const asking = ofType('run_finished').filter(({ next }) => next);
  const requests = ofType('notice_posted').filter(({ source }) => REQUEST_SOURCES.includes(source));
  const reportsOpened = new Set(ofType('report_read', 'report_messaged').map(({ id }) => id));
  const timed = [...ofType('question_ended').filter(({ how }) => how === 'answered'), ...ofType('decision_read')];
  const merges = mergeTotals(landed);

  const board = {
    events: events.length,
    brought: {
      decisions: notTheCard('decision_filed'),
      reports: asking.length,
      requests: requests.length,
    },
    acted: {
      answered: notTheCard('decision_answered'),
      opened: asking.filter(({ id }) => reportsOpened.has(id)).length,
      merged: merges.total,
      declined: count('done_declined'),
      sentBack: count('done_sent_back'),
    },
    answers: { total: timed.length, under3s: timed.filter(({ ms }) => ms < QUICK_MS).length },
    merges,
    settled: {
      recalled: count('decision_recalled'),
      nothingNew: ofType('run_finished').filter(({ triage }) => triage === 'nothing').length,
      watchesClosed: ofType('launch_closed').filter(({ outcome }) => CLEAN_OUTCOMES.includes(outcome)).length,
      harnessFixes: count('harness_filed'),
    },
  };
  const lines = events.length ? [broughtLine(board), attentionLine(board), settledLine(board)].filter(Boolean) : [NO_EVENTS];
  return { ...board, lines };
}
