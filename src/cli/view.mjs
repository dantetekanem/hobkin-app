import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson, loadConfig, readPersona } from './config.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { loadSchedules } from './schedules.mjs';
import { loadImportedHistory } from './history.mjs';
import { UsageLedger } from './usage.mjs';
import { deletedReportIds, readReport } from './reports.mjs';
import { memoryBytes } from './memory.mjs';
import { openDecisions } from './decisions.mjs';
import { callName, readProfile } from './profile.mjs';
import { workStatus } from './work/commands.mjs';
import { PERFORMANCE_TAIL_BYTES, recentPerformanceEvents } from './events.mjs';
import { safeTurnFacts } from './turn-metrics.mjs';

const metricId = value => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,200}$/.test(value);
const metricNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const metricTime = value => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const metricFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'estimatedUsd', 'responseDurationMs'];
export const safePerformance = (facts, runId, sessionId) => {
  if (facts?.schemaVersion !== 1 || facts.runId !== runId || facts.sessionId !== sessionId || !metricId(sessionId)) return null;
  const result = { schemaVersion: 1, runId, sessionId, responses: metricNumber(facts.responses) ? facts.responses : null,
    incomplete: facts.incomplete !== false,
    firstObservedOutputMs: metricNumber(facts.firstObservedOutputMs) ? facts.firstObservedOutputMs : null,
    dispatchElapsedMs: metricNumber(facts.dispatchElapsedMs) ? facts.dispatchElapsedMs : null,
    ...safeTurnFacts(facts) };
  for (const field of metricFields) {
    const scalar = facts[field];
    result[field] = metricNumber(scalar?.value) && ['complete', 'partial'].includes(scalar.state)
      ? { value: scalar.value, state: scalar.state } : { value: null, state: 'unavailable' };
  }
  return result;
};

const helperStatuses = ['queued', 'running', 'cancelling', 'unknown', 'completed', 'failed', 'cancelled'];
const terminalHelper = status => ['completed', 'failed', 'cancelled'].includes(status);
function projectHelpers(rootId, live, events, saved) {
  const candidates = new Map();
  for (const [source, rows] of [['live', live], ['event', events], ['saved', saved]]) {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || !metricId(row.id) || row.id === rootId || row.rootId !== rootId || !metricId(row.parentId)
        || !Number.isInteger(row.depth) || row.depth < 1 || row.depth > 3 || !helperStatuses.includes(row.status)) continue;
      const sessionId = row.sessionId === undefined ? row.performance?.sessionId ?? null : row.sessionId;
      if (sessionId !== null && !metricId(sessionId)) continue;
      const performance = safePerformance(row.performance, row.id, sessionId);
      if (row.performance != null && !performance) continue;
      if (!candidates.has(row.id)) {
        candidates.set(row.id, {
          id: row.id,
          parentId: row.parentId,
          rootId,
          depth: row.depth,
          sessionId,
          status: source === 'saved' && !terminalHelper(row.status) ? 'unknown' : row.status,
          source,
          performance,
        });
      }
    }
  }
  const hasAncestry = row => row.depth === 1 ? row.parentId === rootId
    : candidates.get(row.parentId)?.depth === row.depth - 1 && hasAncestry(candidates.get(row.parentId));
  const retained = [];
  for (const row of [...candidates.values()].sort((a, b) => a.depth - b.depth)) {
    if (hasAncestry(row) && (row.depth === 1 || retained.some(parent => parent.id === row.parentId))) retained.push(row);
    if (retained.length === 32) break;
  }
  return retained;
}

/** Own-session measurements only. Observer delay is not provider-wire TTFT; USD remains an estimate. */
export function projectPerformance(root, runs, { connection = 'connected', asOf = null, liveHelpers = [], savedTelemetry = null } = {}) {
  const tail = recentPerformanceEvents(root);
  const events = new Map(tail.events.map(event => [JSON.stringify([event.runId, event.sessionId]), event]));
  const parents = runs.filter(run => metricId(run.id) && !run.parentRunId);
  const selected = [...parents.filter(run => run.status === 'running'), ...parents.filter(run => run.status !== 'running')].slice(0, 100);
  return { schemaVersion: 1, connection, stale: connection !== 'connected', asOf: metricTime(asOf),
    scope: 'own-parent-and-helpers', helpers: 'owned',
    retention: { maxRuns: 100, maxHelpersPerRun: 32, maxEventKeys: 100, eventMonthFiles: 2, eventTailBytesPerFile: PERFORMANCE_TAIL_BYTES,
      eventReadState: tail.state, eventTailTruncated: tail.truncated, history: 'bounded' },
    runs: selected.map(run => {
      const sessionId = run.result?.sessionId ?? run.sessionId ?? run.performance?.sessionId ?? run.result?.performance?.sessionId ?? null;
      const metricRunId = run.harnessId ?? run.id;
      const validIdentity = metricId(metricRunId) && (run.result?.id === undefined || run.result.id === metricRunId);
      const receipt = validIdentity
        ? safePerformance(run.performance, metricRunId, sessionId) ?? safePerformance(run.result?.performance, metricRunId, sessionId)
        : null;
      const matchingEvent = events.get(JSON.stringify([metricRunId, sessionId]));
      const event = validIdentity && !matchingEvent?.ownedHelper ? safePerformance(matchingEvent, metricRunId, sessionId) : null;
      const previous = Array.isArray(savedTelemetry?.runs)
        ? savedTelemetry.runs.slice(0, 100).find(row => row?.runId === run.id && row.sessionId === sessionId)
        : null;
      const helperEvents = tail.events.filter(item => item.ownedHelper?.id === item.runId && terminalHelper(item.ownedHelper.status))
        .map(item => ({ ...item.ownedHelper, sessionId: item.sessionId, performance: item.schemaVersion === 1 ? item : null }));
      return { runId: run.id, sessionId: metricId(sessionId) ? sessionId : null,
        kind: ['main', 'background'].includes(run.kind) ? run.kind : 'unknown',
        status: ['running', 'completed', 'failed', 'interrupted', 'no_change', 'incomplete'].includes(run.status) ? run.status : 'unknown',
        startedAt: metricTime(run.startedAt), finishedAt: metricTime(run.finishedAt),
        source: receipt ? (connection === 'offline' ? 'saved' : 'receipt') : event ? 'event' : 'unavailable', performance: receipt ?? event,
        helpers: projectHelpers(run.id, connection === 'offline' ? [] : liveHelpers, helperEvents, previous?.helpers),
      };
    }),
  };
}

const presentationPath = requestedRoot => join(resolveDataRoot(requestedRoot), 'runtime', 'presentation.json');
const normalizeMessageIds = value => {
  if (!Array.isArray(value) || value.length > 100000
    || value.some(id => typeof id !== 'string' || !id || id.length > 256)) {
    throw Error('Saved presentation state has invalid message IDs.');
  }
  return [...new Set(value)];
};

export function readPresentationState(requestedRoot) {
  const file = presentationPath(requestedRoot);
  if (!existsSync(file)) return { version: 1, hiddenMessageIds: [] };
  const stat = lstatSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 1048576) {
    throw Error('Saved presentation state must be a private bounded regular file.');
  }
  let saved;
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw Error('Invalid saved presentation state.');
  }
  if (saved?.version !== 1) throw Error('Unsupported saved presentation state.');
  return { version: 1, hiddenMessageIds: normalizeMessageIds(saved.hiddenMessageIds) };
}

export function savePresentationState(requestedRoot, messageIds) {
  if (!Array.isArray(messageIds)) throw Error('Presentation clear state requires message IDs.');
  const root = resolveDataRoot(requestedRoot);
  const previous = readPresentationState(root);
  const hiddenMessageIds = normalizeMessageIds([...previous.hiddenMessageIds, ...messageIds]);
  const saved = { version: 1, hiddenMessageIds };
  if (Buffer.byteLength(`${JSON.stringify(saved, null, 2)}\n`) > 1048576) {
    throw Error('Saved presentation state exceeds its byte limit.');
  }
  atomicJson(join(root, 'runtime', 'presentation.json'), saved);
  return saved;
}

/** Finite, read-only snapshot. A saved run is not evidence of a live process. */
export function readLocalView(requestedRoot) {
  const root = resolveDataRoot(requestedRoot);
  const config = loadConfig(root);
  const loaded = loadSchedules(root);
  const history = loadImportedHistory(root);
  const file = join(root, 'runtime/view.json');
  let saved = {};
  if (existsSync(file)) {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 16777216) throw Error('Saved dashboard must be a bounded regular file.');
    saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved.version !== 1) throw Error('Unsupported saved dashboard.');
  }
  const deleted = deletedReportIds(root);
  const reports = [...new Map([...(saved.reports ?? []), ...history.reports]
    .filter(report => report.id !== 'patterns-offer' && !deleted.has(report.id))
    .map(report => [report.id, { ...report, body: readReport(root, report.id, report.body) }])).values()]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const presentation = readPresentationState(root);
  const performanceRuns = Array.isArray(saved.telemetry?.runs) ? saved.telemetry.runs : saved.runs ?? [];
  return {
    ...saved,
    // Current saved selection overrides the cached dashboard, not any running turn.
    persona: readPersona(root),
    config,
    ...loaded,
    history,
    reports,
    presentation,
    messages: saved.messages ?? [],
    runs: saved.runs ?? [],
    connection: 'offline',
    telemetry: projectPerformance(root, performanceRuns.slice(0, 100).filter(run => run && typeof run === 'object')
      .map(run => ({ ...(saved.runs ?? []).find(metadata => metadata.id === (run.runId ?? run.id)),
        ...run, id: run.runId ?? run.id, status: run.status ?? run.state })),
    { connection: 'offline', asOf: saved.savedAt, savedTelemetry: saved.telemetry }),
    usage: UsageLedger.open(root, config.initializedAt).snapshot(),
    memoryBytes: memoryBytes(root),
    work: workStatus(root),
    decisions: openDecisions(root),
    learning: config.learning?.enabled === true,
    userName: callName(readProfile(root)),
  };
}
