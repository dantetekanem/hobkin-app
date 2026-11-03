import { fileURLToPath } from 'node:url';
import { eventsFolder, readEvents, recordEvent } from '../events.mjs';
import { hobkinCommand } from './chat.mjs';
import { chosenProjects, fileItem, readItems, readMode, realFolder, slugOf, writeMode } from './store.mjs';

const DAY_MS = 86400000;
// Once can be bad luck, and the same failure a third time in a day is hobkin's to fix.
const REPEATS_AT = 3;
const MOST_EVENTS_NAMED = 8;

const times = count => `${count} ${count === 1 ? 'time' : 'times'}`;
const iso = time => new Date(time).toISOString();

const runClass = ({ lane, routine, kind }) => {
  if (lane) return { name: `run:${lane}`, what: `failed ${lane} runs` };
  return { name: `run:${routine ?? kind}`, what: routine ? `failed runs of the ${routine} routine` : `failed ${kind} runs` };
};

const failedClasses = {
  run_finished: runClass,
  turn_finished: () => ({ name: 'run:main', what: 'failed main turns' }),
  compaction_finished: () => ({ name: 'compaction', what: 'failed compactions' }),
};

/** A status of `failed` is the harness giving up. A run that found a problem in its project completes, and a limit is the provider's word, not a fault here. */
function classOf(event) {
  const { type, from, status, limited } = event;
  if (type === 'error_shown') return { name: `error:${slugOf(from)}`, what: `errors on screen from ${from}` };
  return status === 'failed' && !limited ? failedClasses[type]?.(event) : undefined;
}

/** Each class seen often enough in these events, with the events that make it one. */
export function repeatedFailures(events) {
  const found = events.flatMap(event => {
    const failure = classOf(event);
    return failure ? [{ ...failure, event }] : [];
  });
  return [...Map.groupBy(found, ({ name }) => name).values()]
    .filter(own => own.length >= REPEATS_AT)
    .map(own => ({ name: own[0].name, what: own[0].what, key: `harness:${own[0].name}`, count: own.length, events: own.map(({ event }) => event) }));
}

const eventLine = ({ type, id, at, project, item }) => [type, id, `at ${at}`, project && `on ${project}`, item && `item ${item}`].filter(Boolean).join(' ');

function eventsToLook(events) {
  const named = events.toSorted((left, right) => right.at.localeCompare(left.at)).slice(0, MOST_EVENTS_NAMED);
  const rest = events.length - named.length;
  return `${named.map(eventLine).join('; ')}${rest ? `; and ${rest} more` : ''}`;
}

const briefFor = (root, { key, what, count, events }) => [
  `hobkin's own harness did this ${times(count)} in a day: ${what}. The class is ${key}.`,
  `Events hold facts and no words, so start from these in ${eventsFolder(root)}: ${eventsToLook(events)}.`,
  `Read what happened around each one, and for a run read its report with \`${hobkinCommand(root, 'reports')}\`, then find the cause in the code that reported it.`,
  'Prove the fix with a test that fails now on this failure and passes after it.',
].join(' ');

function fileFailure(root, slug, failure, now) {
  const { key, name, what, count } = failure;
  if (readItems(root, slug).some(item => item.key === key)) return [];

  const { id } = fileItem(root, slug, { key, kind: 'fix', title: `Stop the ${what}`, brief: briefFor(root, failure), impact: 'high' }, now);
  recordEvent(root, 'harness_filed', { name, count, project: slug, item: id }, now);
  return [{ key, id }];
}

const chatLine = ({ what, count }) => `hobkin's own harness: ${what}, ${times(count)} in a day. Nothing was filed, because hobkin is not a chosen project.`;

/** A class is told once for good. Only the newest lines stay in the mode, so one that has scrolled out of Chat cannot come back. */
function tellChat(root, failures, now) {
  const { harnessTold = [] } = readMode(root);
  const lines = failures.filter(({ key }) => !harnessTold.includes(key)).map(failure => ({ key: failure.key, line: chatLine(failure), at: iso(now) }));
  writeMode(root, { harnessLines: lines, harnessTold: [...harnessTold, ...lines.map(({ key }) => key)] });
  return lines;
}

const folderOf = path => {
  try {
    return realFolder(path);
  } catch {
    return path;
  }
};

const hobkinProject = (root, checkout) => chosenProjects(root).find(({ path }) => path && folderOf(path) === folderOf(checkout));

export const upkeepDue = ({ upkeepAt }, now) => !upkeepAt || now - Date.parse(upkeepAt) >= DAY_MS;

/**
 * hobkin looks after itself: a failure in its own harness is never a call, so what repeats goes on its own list. Code only, and it starts nothing.
 * A fix waits its turn like any other item and is not urgent, so shipping first holds it too. Each key is filed once and told once.
 */
export function lookAfterHarness(root, { now = Date.now(), events = readEvents(root, { since: now - DAY_MS }), checkout = fileURLToPath(new URL('../../../', import.meta.url)) } = {}) {
  const failures = repeatedFailures(events);
  const project = hobkinProject(root, checkout);
  const filed = project ? failures.flatMap(failure => fileFailure(root, project.slug, failure, now)) : [];
  return { filed, told: tellChat(root, project ? [] : failures, now) };
}
