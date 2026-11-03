import { learningEnabled } from './config.mjs';
import { openDecisions } from './decisions.mjs';
import { learningState } from './learning/store.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { pendingCard } from './pending.mjs';
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

/** What waits on the user right now, from what is on disk. It writes nothing, so another process can ask. A dashboard passes the reports it already holds. */
export function readPending(requestedRoot, { now = Date.now(), reports } = {}) {
  const root = resolveDataRoot(requestedRoot);
  return pendingCard({
    ready: readyItems(root, Infinity),
    decisions: openDecisions(root),
    attention: attentionView(root),
    proposals: learningEnabled(root) ? learningState(root).proposals : [],
    launches: launchesIn(root),
    reports: reports ?? readLocalView(root).reports,
    read: readReportIds(root),
    now,
  });
}
