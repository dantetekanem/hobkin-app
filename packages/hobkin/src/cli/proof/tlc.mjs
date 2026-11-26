import { availableParallelism, totalmem } from 'node:os';
import { readMessage } from './tool-messages.mjs';

/** Half the machine's cores, so TLC leaves room for everything else. */
export const defaultWorkers = (cores = availableParallelism()) => Math.max(1, Math.floor(cores / 2));

/** TLC's heap cap: a quarter of the memory, between 256 MB and 4 GB. */
export const heapMegabytes = (total = totalmem()) => Math.max(256, Math.min(4096, Math.floor(total / 4 / 2 ** 20)));

/** SANY and TLC also read the modules in `library`, such as TLAPS's standard library, when there is one. */
const libraryFlag = library => (library ? [`-DTLA-Library=${library}`] : []);

export const sanyArguments = ({ jar, spec, library }) => [...libraryFlag(library), '-cp', jar, 'tla2sany.SANY', spec];

/**
 * TLC in tool mode, breadth first so a counterexample is the shortest one, with coverage every minute. Its state files go
 * in the run's folder, never next to the spec. `dot` adds the state graph dump. v1.7.4 has no `-dumpTrace`, so the trace
 * comes from the states TLC prints.
 */
export const tlcArguments = ({ jar, spec, cfg, workers, heap, metadir, dot, library }) => [
  `-Xmx${heap}m`,
  '-XX:+UseParallelGC',
  ...libraryFlag(library),
  '-cp', jar,
  'tlc2.TLC',
  '-tool',
  '-workers', String(workers),
  '-coverage', '1',
  '-config', cfg,
  '-metadir', metadir,
  ...(dot ? ['-dump', 'dot,actionlabels,colorize', dot] : []),
  spec,
];

/**
 * What one TLC run said, gathered from its messages: the latest counts, the violation and its trace, the actions'
 * coverage and any error. `onProgress` and `onCoverage` hear the counts and the coverage as they come.
 */
export function tlcOutcome({ onProgress = () => {}, onCoverage = () => {} } = {}) {
  const seen = {
    stats: { generated: 0, distinct: 0, queue: 0, depth: 0 },
    success: false,
    finished: false,
    violation: null,
    error: null,
    states: [],
    coverage: new Map(),
  };
  let tracing = false;
  let coverage = null;

  const message = raw => {
    if (raw.code === null) return;
    const event = readMessage(raw);
    switch (event.kind) {
      case 'progress':
        seen.stats = { generated: event.generated, distinct: event.distinct, queue: event.queue, depth: event.depth };
        onProgress(seen.stats);
        break;
      case 'stats':
        seen.stats = { ...seen.stats, generated: event.generated, distinct: event.distinct, queue: event.queue };
        onProgress(seen.stats);
        break;
      case 'depth':
        seen.stats = { ...seen.stats, depth: event.depth };
        break;
      case 'success':
        seen.success = true;
        break;
      case 'finished':
        seen.finished = true;
        break;
      case 'violation':
        // The first is the one TLC traces.
        seen.violation ??= event;
        if (event.state !== undefined) seen.states.push({ kind: 'state', n: 1, action: 'Init', line: null, text: event.state });
        break;
      case 'error':
        seen.error ??= event;
        break;
      case 'trace':
        tracing = true;
        break;
      case 'state':
      case 'stuttering':
      case 'back':
        if (tracing) seen.states.push(event);
        break;
      case 'coverage-start':
        coverage = new Map();
        break;
      case 'coverage': {
        // An action defined as several disjuncts is reported once for each. `found` is every state the action led to and
        // `distinct` only the new ones, so an action that only revisits known states was still taken.
        if (!coverage) break;
        const sofar = coverage.get(event.name) ?? { taken: 0, distinct: 0 };
        coverage.set(event.name, {
          taken: sofar.taken + event.found,
          distinct: sofar.distinct + event.distinct,
        });
        break;
      }
      case 'coverage-end':
        if (coverage) {
          seen.coverage = coverage;
          onCoverage(coverage);
        }
        coverage = null;
        break;
    }
  };
  return { message, seen };
}
