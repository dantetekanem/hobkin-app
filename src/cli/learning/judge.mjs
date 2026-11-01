import { inconclusive, scheduleDefinition, stalled } from '../checks.mjs';
import { reportTriage } from '../reports.mjs';
import { clearedAt } from './store.mjs';

const DAY_MS = 86400000;
// Long enough for a report to be opened, since a line in Chat is read first.
const READ_GRACE_MS = 3 * DAY_MS;
const PR_WAIT_MS = 14 * DAY_MS;
// A monthly check needs a season to show a pattern.
const EVIDENCE_MS = 120 * DAY_MS;

const stallOf = run => ({ is: reportTriage(run)?.level === 'blocked' ? 'blocked' : 'failed' });

/** Right or wrong comes from the outcome, and approved or not from what the user did next. Of a report, only its triage word is read. */
export function judgeRun(run, { read, asked, rejected, since }, now) {
  if (inconclusive(run)) return null;
  if (stalled(run)) return stallOf(run);
  if (rejected.has(run.id)) return { is: 'rejected' };
  if (asked.has(run.id)) return { is: 'used', by: 'asked' };
  if (run.trigger === 'manual') return { is: 'used', by: 'requested' };

  const level = reportTriage(run)?.level;
  if (level === 'nothing' || run.status === 'no_change') return { is: 'quiet' };
  if (read.has(run.id) || level === 'critical') return { is: 'used' };

  const finished = Date.parse(run.finishedAt);
  return finished >= since && now - finished >= READ_GRACE_MS ? { is: 'unread' } : null;
}

// A work run's report stays out of Chat, so only whether it finished says anything. Its worth shows in what it filed.
const judgeLane = run => {
  if (inconclusive(run)) return null;
  return stalled(run) ? stallOf(run) : { is: 'done' };
};

/** An item's worth is where it ended up. Hobkin never merges, so a merge is the user's yes. */
export function judgeItem(item, pullRequest, now) {
  if (item.state === 'stuck') return 'stuck';
  if (item.state === 'declined') return 'closed';
  if (item.state !== 'pr') return null;
  if (pullRequest?.state === 'MERGED') return 'merged';
  if (pullRequest?.state === 'CLOSED') return 'closed';
  const waiting = pullRequest?.state === 'OPEN' && now - Date.parse(item.updatedAt ?? item.at) >= PR_WAIT_MS;
  return waiting ? 'unmerged' : null;
}

/** A project the user named was never proposed, so it says nothing about what discovery offers. */
export function judgeProject({ state, summary }) {
  if (!summary) return null;
  if (state === 'chosen') return 'taken';
  return ['skipped', 'dropped'].includes(state) ? 'skipped' : null;
}

const flatten = text => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const TURNED_DOWN = /\b(?:wrong|incorrect|useless|nonsense|false alarm|(?:is|just) noise|waste of|not (?:true|right|correct|useful|helpful|relevant)|stop (?:sending|reporting)|errado|incorreto|inutil|besteira|bobagem|nao (?:serve|ajuda|e isso|e verdade|faz sentido))\b/;
const NOT_TURNED_DOWN = /\b(?:not|never|nao|nothing) (?:wrong|incorrect|useless|errado|incorreto|inutil)\b/;

/** Reads a reply about a report for one thing only, and keeps none of its words. A question is not an answer. */
export function rejectsReport(text) {
  const plain = flatten(String(text ?? ''));
  return !plain.includes('?') && TURNED_DOWN.test(plain) && !NOT_TURNED_DOWN.test(plain);
}

const judged = (id, at, verdict, usd) => (verdict ? [{ run: id, at, ...verdict, ...(usd > 0 ? { usd } : {}) }] : []);

function checkEvidence(schedule, { runs, signals, attention, now }) {
  const definition = scheduleDefinition(schedule);
  const own = runs.filter(run => run.scheduleId === schedule.id && !run.work && (!run.definition || run.definition === definition));
  return {
    scope: schedule.id,
    title: schedule.title,
    definition,
    ignored: attention.some(item => item.scheduleId === schedule.id && item.ignored),
    verdicts: own.flatMap(run => judged(run.id, run.finishedAt, judgeRun(run, signals, now), run.cost?.usd)),
  };
}

function projectEvidence({ slug, name }, { runs, itemsOf, pullRequests, now }) {
  const subjects = Map.groupBy(itemsOf(slug).filter(item => item.kind !== 'attention'), ({ key, kind }) => (key?.startsWith('idea:') ? 'ideas' : kind));
  const lanes = ['look', 'do'].map(lane => ({
    scope: `work.${slug}.${lane}`,
    title: `${name} ${lane}`,
    verdicts: runs.filter(run => run.scheduleId === `work.${slug}.${lane}`).flatMap(run => judged(run.id, run.finishedAt, judgeLane(run))),
  }));
  const filed = [...subjects].map(([subject, items]) => ({
    scope: `work.${slug}.${subject}`,
    title: `${name} ${subject}`,
    verdicts: items.flatMap(item => {
      const is = judgeItem(item, pullRequests[item.pr], now);
      return judged(item.id, item.updatedAt ?? item.at, is && { is });
    }),
  }));
  return [...lanes, ...filed];
}

function discoveryEvidence({ runs, projects }) {
  const looks = runs.filter(run => run.scheduleId === 'work.discover').flatMap(run => judged(run.id, run.finishedAt, judgeLane(run)));
  const answers = projects.flatMap(project => {
    const is = judgeProject(project);
    return judged(project.slug, project.at, is && { is });
  });
  return { scope: 'work.discover', title: 'Finding projects', verdicts: [...looks, ...answers] };
}

/** Every verdict the evidence supports, by what it is about. All of it already exists, so gathering it spends nothing. */
export function gatherEvidence({ schedules, clears, ...sources }) {
  const { projects, now } = sources;
  const taken = projects.filter(project => project.state === 'chosen');
  const subjects = [
    ...schedules.map(schedule => checkEvidence(schedule, sources)),
    discoveryEvidence(sources),
    ...taken.flatMap(project => projectEvidence(project, sources)),
  ];
  return subjects.map(subject => ({
    ...subject,
    verdicts: subject.verdicts.filter(({ at }) => now - Date.parse(at) <= EVIDENCE_MS && Date.parse(at) > clearedAt(clears, subject.scope)),
  }));
}
