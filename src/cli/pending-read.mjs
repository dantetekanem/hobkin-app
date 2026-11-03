import { learningEnabled } from './config.mjs';
import { openDecisions } from './decisions.mjs';
import { proposalQuestion } from './learning/lessons.mjs';
import { learningState } from './learning/store.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { pendingCard, waitingRows } from './pending.mjs';
import { readReportIds } from './telemetry.mjs';
import { readLocalView } from './view.mjs';
import { nameOf } from './work/names.mjs';
import { attentionView, readyItems } from './work/reads.mjs';
import { readItems, readLaunches, readProjects } from './work/store.mjs';

// The watch closes a launch the moment it goes wrong, so what ends the trouble for the user is the fix it filed.
const FIX_OVER = ['merged', 'done', 'dropped', 'declined'];

function launchesOf(root, project) {
  const { slug } = project;
  const fixes = readItems(root, slug).filter(({ causedBy, state }) => causedBy && FIX_OVER.includes(state));
  return readLaunches(root, slug).map(launch => ({
    ...launch,
    slug,
    project: nameOf(project),
    fixed: fixes.some(({ causedBy }) => causedBy === launch.item),
  }));
}

const launchesIn = root => readProjects(root).flatMap(project => launchesOf(root, project));

const proposalsIn = root => (learningEnabled(root) ? learningState(root).proposals : [])
  .map(proposal => ({ ...proposal, question: proposalQuestion(proposal) }));

function pendingInputs(requestedRoot, { now, reports }) {
  const root = resolveDataRoot(requestedRoot);
  return {
    ready: readyItems(root, Infinity),
    decisions: openDecisions(root),
    attention: attentionView(root),
    proposals: proposalsIn(root),
    launches: launchesIn(root),
    reports: reports ?? readLocalView(root).reports,
    read: readReportIds(root),
    now,
  };
}

/** What waits on the user right now, from what is on disk. It writes nothing, so another process can ask. A dashboard passes the reports it already holds. */
export const readPending = (requestedRoot, { now = Date.now(), reports } = {}) => pendingCard(pendingInputs(requestedRoot, { now, reports }));

// The dashboard already holds each report's text, so a report row carries only what lists and opens it.
const reportRow = ({ id, title, at, triage }) => ({ id, title, at, level: triage.level, next: triage.next });

/** The same rows one by one, for the Decisions tab. */
export function readWaiting(requestedRoot, { now = Date.now(), reports } = {}) {
  const rows = waitingRows(pendingInputs(requestedRoot, { now, reports }));
  return { ...rows, reports: rows.reports.map(reportRow) };
}
