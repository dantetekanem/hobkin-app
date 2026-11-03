import { learningEnabled } from './config.mjs';
import { openDecisions } from './decisions.mjs';
import { learningState } from './learning/store.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { pendingCard } from './pending.mjs';
import { readReportIds } from './telemetry.mjs';
import { readLocalView } from './view.mjs';
import { nameOf } from './work/names.mjs';
import { attentionView, readyItems } from './work/reads.mjs';
import { readLaunches, readProjects } from './work/store.mjs';

const launchesIn = root => readProjects(root)
  .flatMap(project => readLaunches(root, project.slug).map(launch => ({ ...launch, slug: project.slug, project: nameOf(project) })));

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
