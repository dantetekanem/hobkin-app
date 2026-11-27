import { scheduleDefinition } from './checks.mjs';
import { fileActionItem, latestAnswer, openDecisions, settleDecision } from './decisions.mjs';
import { recordEvent } from './events.mjs';

const DAY_MS = 86400000;
// Not now is not no, so it can come back once the week is out.
const LATER_MS = 7 * DAY_MS;
// A routine that finds nothing most times watches too often, which is a different call from one whose reports go unopened.
const QUIET_SHARE = 0.8;
const ROUTINE_KEY = 'care:routine:';
const TEMPLATE_KEY = 'care:template:';
const STILL_WORTH_IT = 'Only you know whether it still earns its place.';

const notNow = { value: 'later', label: 'Not now' };
const turnOff = { value: 'off', label: 'Turn it off' };
const asItIs = { value: 'keep', label: 'Keep it as it is' };
const UNREAD = [notNow, turnOff, { value: 'rework', label: 'Rework it with hobkin' }, asItIs];
const QUIET = [notNow, { value: 'less', label: 'Run it less often' }, turnOff, asItIs];
const NEW_TEMPLATE = [{ value: 'try', label: 'Set one up with hobkin' }, { value: 'no', label: 'Not for me' }];
const NEW_TEMPLATES = [{ value: 'some', label: 'Set some up with hobkin' }, { value: 'no', label: 'Not for me' }];
// An action item's text is cut at 1000 characters, so a long list names the templates by title alone rather than lose its end.
const LONGEST_LIST = 1000;
const NEWER_TEMPLATE = [{ value: 'update', label: 'Bring it into my routine' }, { value: 'no', label: 'I do not use it' }];

/** What each answer asks the main agent to do, in the user's words. Every other answer only closes the item. */
export const ROUTINE_ASKS = {
  off: 'Turn this routine off.',
  rework: 'Rework this routine with me.',
  less: 'Run this routine less often.',
  try: 'Set up a routine from this template with me.',
  some: 'Set up routines from some of these templates with me.',
  update: 'Bring the newer version of this template into my routine.',
};

const costLine = ({ usd, reports }) => (usd > 0 ? `Each run costs about $${(usd / reports).toFixed(2)}. ` : '');

// An edit makes it a new routine as far as this goes, so its definition is in the key, and an answer about the old one does not hold for the new.
function routineItem(schedule, seen) {
  const { reports, read, nothingNew } = seen;
  const about = `${ROUTINE_KEY}${schedule.id}:${scheduleDefinition(schedule).slice(0, 12)}`;
  const answerTo = { kind: 'routines', subject: 'routine', id: schedule.id, file: schedule.path, seen: [reports, read, nothingNew, costLine(seen)].join('|') };
  if (nothingNew / reports >= QUIET_SHARE) {
    return {
      key: `${about}:quiet`,
      title: `Nothing new in ${nothingNew} of the last ${reports} runs of ${schedule.title}`,
      detail: `${costLine(seen)}Running it less often would cost less, and turning it off ends it.`,
      choices: QUIET,
      answerTo,
    };
  }
  return {
    key: `${about}:unread`,
    title: `You opened ${read} of the last ${reports} reports from ${schedule.title}`,
    detail: `${costLine(seen)}Turning it off saves its runs, and reworking it could make its reports worth opening.`,
    choices: UNREAD,
    answerTo,
  };
}

/** An answer holds for its key: not now for a week, anything else for good. Evidence that settled one says nothing about what the user wants. */
function answered(root, key, now) {
  const earlier = latestAnswer(root, key);
  if (!earlier || earlier.evidence) return false;
  return earlier.answer !== 'later' || now - Date.parse(earlier.answeredAt) < LATER_MS;
}

function whatSettled({ answerTo }, schedules) {
  const schedule = schedules.find(({ id }) => id === answerTo.id);
  if (!schedule) return 'It is no longer a routine.';
  return schedule.enabled ? 'Its latest runs no longer show this.' : 'It was turned off.';
}

/**
 * hobkin looks after the user's routines the way it looks after its own harness: code only, from how their reports were used, and it changes
 * nothing. A routine whose reports go unopened, or that finds nothing most times, gets one item, and the item closes itself once that stops being
 * true. `attention` is the report attention rollup, and `schedules` the routines as loaded. With `partial`, some routine files did not load, so a
 * routine missing from the list may only be unreadable, and its item stays.
 */
export function lookAfterRoutines(root, { schedules, attention, partial = false, now = Date.now() }) {
  const recurring = schedules.filter(({ enabled, cadence }) => enabled && cadence !== 'once');
  const wanted = attention.filter(({ ignored }) => ignored).flatMap(seen => {
    const schedule = recurring.find(({ id }) => id === seen.scheduleId);
    return schedule ? [routineItem(schedule, seen)] : [];
  });
  const open = openDecisions(root).filter(({ key }) => key?.startsWith(ROUTINE_KEY));
  const missing = ({ answerTo }) => !schedules.some(({ id }) => id === answerTo.id);
  const settled = open.filter(item => !wanted.some(({ key }) => key === item.key) && !(partial && missing(item)));
  for (const item of settled) settleDecision(root, item.id, whatSettled(item, schedules), now);
  // Filing again only brings the numbers up to date, so it happens only when they moved.
  const filed = wanted.filter(item => {
    const known = open.find(({ key }) => key === item.key);
    return known ? known.answerTo?.seen !== item.answerTo.seen : !answered(root, item.key, now);
  });
  for (const item of filed) fileActionItem(root, { ...item, from: 'hobkin', why: STILL_WORTH_IT }, now);
  if (filed.length || settled.length) recordEvent(root, 'routines_looked_after', { filed: filed.length, settled: settled.length }, now);
  return { filed: filed.map(({ key }) => key), settled: settled.map(({ id }) => id) };
}

const HOUR_MS = 60 * 60000;
// The last look for each home. A restart looks again at once, which files nothing the numbers did not move.
const lookedAt = new Map();

/**
 * Once an hour from the host's tick, with the routines as the runner loaded them and the dashboard's attention rollup. Before the first
 * refresh there is no rollup, so it waits for the next tick. An error about a file no routine came from means one did not load. A problem
 * costs this look and nothing else.
 */
export function tickRoutineCare(root, { loaded, attention, now = Date.now() }) {
  if (now - (lookedAt.get(root) ?? -Infinity) < HOUR_MS) return null;
  if (!Array.isArray(loaded?.schedules) || !Array.isArray(attention)) return null;
  lookedAt.set(root, now);
  try {
    const { schedules, errors = [] } = loaded;
    const partial = errors.some(({ path }) => !schedules.some(schedule => schedule.path === path));
    return lookAfterRoutines(root, { schedules, attention, partial, now });
  } catch {
    return null;
  }
}

const lowerFirst = text => text.charAt(0).toLowerCase() + text.slice(1);

function oneNew(template) {
  return {
    key: `${TEMPLATE_KEY}${template.id}:${template.version}`,
    title: `Try the ${template.title} template`,
    detail: `${template.summary} It fits ${lowerFirst(template.fits)}`,
    choices: NEW_TEMPLATE,
    answerTo: { kind: 'routines', subject: 'template', id: template.id, file: template.file },
  };
}

/** Several new templates from one update are one item, so an update never fills Action Items. Its key is the set it lists. */
function severalNew(templates) {
  const ids = templates.map(({ id, version }) => `${id}@${version}`).toSorted();
  const full = templates.map(({ title, summary }) => `- ${title}: ${summary}`).join('\n');
  return {
    key: `${TEMPLATE_KEY}new:${ids.join(',')}`,
    title: `${templates.length} new routine templates`,
    detail: full.length <= LONGEST_LIST ? full : templates.map(({ title }) => `- ${title}`).join('\n'),
    choices: NEW_TEMPLATES,
    answerTo: { kind: 'routines', subject: 'templates', ids },
  };
}

function newerOne(template) {
  return {
    key: `${TEMPLATE_KEY}${template.id}:${template.version}`,
    title: `The ${template.title} template has a newer version`,
    detail: `${template.summary} A routine made from the older version keeps working as it is until you bring the change in.`,
    choices: NEWER_TEMPLATE,
    answerTo: { kind: 'routines', subject: 'template', id: template.id, file: template.file },
  };
}

/**
 * What an update brought, as items the user can take up or turn down: one for a new template, one for all of them when it brought several,
 * and one for each newer version, since each asks about the one routine made from it. A version is in the key, so a newer one asks again.
 */
export function fileTemplateNews(root, { added = [], updated = [] }, now = Date.now()) {
  const items = [...(added.length > 1 ? [severalNew(added)] : added.map(oneNew)), ...updated.map(newerOne)];
  const waiting = new Set(openDecisions(root).map(({ key }) => key));
  const filed = [];
  for (const item of items) {
    if (waiting.has(item.key) || answered(root, item.key, now)) continue;
    fileActionItem(root, { ...item, from: 'hobkin' }, now);
    filed.push(item.key);
  }
  return filed;
}
