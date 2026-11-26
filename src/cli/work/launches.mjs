import { recordEvent } from '../events.mjs';
import { canWatch, readSignals } from './signals.mjs';
import { chosenProjects, fileItem, paths, readItems, readLaunches, recordLaunch } from './store.mjs';
import { defaultBranch, gitOrNothing, gitWithin, isMerged } from './tree.mjs';
import { ciState, ghWithin } from './unmerged.mjs';

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const LIVE_FOR_MS = 2 * DAY_MS;
const MOST_WATCHED_MS = 7 * DAY_MS;
const REVERTS_FOR_MS = 14 * DAY_MS;
const FIRST_LOOK_AFTER_MS = HOUR_MS;
const LOOK_EVERY_MS = 12 * HOUR_MS;
// The survey waits for the pulse, and the next survey for that, so nothing here may hang on a site or a remote that never answers.
const GH_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 60000;
const HEALTH_TIMEOUT_MS = 10000;
const SHORT_SHA = 7;
const MOST_FILES_KEPT = 100;
const MOST_NOTE_LENGTH = 2000;
const REVERTS_READ = 200;
const undoWays = ['code', 'one-way', 'forward-fix', 'two-phase', 'permanent'];
const cleanOutcomes = ['held', 'quiet'];
const ciWords = { passing: 'CI passing', failing: 'CI failing', pending: 'CI running', none: 'no CI runs', gap: 'CI could not be read' };
const healthWords = { up: 'health up', down: 'health down', gap: 'health could not be read' };

const defaultGh = ghWithin(GH_TIMEOUT_MS);
const gitToFetch = gitWithin(FETCH_TIMEOUT_MS);
const iso = time => new Date(time).toISOString();
const lines = text => text.split('\n').filter(Boolean);
const itemWithId = (items, id) => items.find(item => item.id === id);

export const openLaunches = launches => launches.filter(({ stage }) => stage !== 'closed');

/** A run says these with its outcome. A wrong word fails the record, and the run gets the list to put it right. */
export function assertLaunch({ undo, flag }) {
  if (!undoWays.includes(undo)) throw Error(`undo must be one of: ${undoWays.join(', ')}`);
  if (flag && (!flag.name || Number.isNaN(Date.parse(flag.expires)))) throw Error('A flag needs a name, and the date it expires as expires.');
}

/** Merging writes `landed` on an item, and this is what turns that into something to watch. A PR that merged on the remote is on origin already. */
function openNew(root, slug, now) {
  const known = new Set(readLaunches(root, slug).map(({ item }) => item));
  for (const { id, landed } of readItems(root, slug)) {
    if (!landed || known.has(id)) continue;
    const pushed = landed.route === 'remote' ? { stage: 'pushed', pushedAt: landed.at } : { stage: 'merged' };
    recordLaunch(root, slug, { item: id, sha: landed.sha, mergedAt: landed.at, ...pushed }, now);
  }
}

const stillWatched = ({ stage, outcome, mergedAt }, now) => stage !== 'closed' || (outcome !== 'trouble' && now - Date.parse(mergedAt) < REVERTS_FOR_MS);

async function filesOf(repo, sha) {
  return lines(await gitOrNothing(repo, 'diff', '--name-only', `${sha}^1`, sha)).slice(0, MOST_FILES_KEPT);
}

// Cancelled is what a newer push does to a run, so it says nothing about this commit.
const countsForCi = ({ conclusion }) => !/cancel/i.test(conclusion ?? '');

async function ciOn({ repo, origin }, sha, gh) {
  try {
    const runs = JSON.parse(await gh(['run', 'list', '--repo', origin, '--commit', sha, '--json', 'status,conclusion'], repo));
    return Array.isArray(runs) ? ciState(runs.filter(countsForCi)) : 'gap';
  } catch {
    return 'gap';
  }
}

async function healthOf(url, fetchPage) {
  if (!url) return null;
  try {
    const response = await fetchPage(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    await response.body?.cancel();
    return response.ok ? 'up' : 'down';
  } catch {
    return 'gap';
  }
}

const plainTitle = subject => subject.replace(/^Merge: /, '').replace(/ \(#\d+\)$/, '');

async function revertsAfter({ repo, tips }, sha) {
  const log = await gitOrNothing(repo, 'log', `--max-count=${REVERTS_READ}`, '--format=%H%x1f%s%x1f%b%x1e', '--grep=^Revert "', '--grep=This reverts commit', ...tips, `^${sha}`);
  return log.split('\x1e').filter(entry => entry.trim()).map(entry => {
    const [hash, subject, body] = entry.trim().split('\x1f');
    return { hash, subject, body };
  });
}

/** What a revert names: the merge, any commit it brought in, or by title when a revert on GitHub or of a squash leaves only that. */
async function revertOf(place, { sha }, title) {
  const brought = [sha, ...lines(await gitOrNothing(place.repo, 'rev-list', `${sha}^1..${sha}`))];
  const namesIt = ({ subject, body }) => {
    const named = [...body.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)].map(match => match[1]);
    const [, quoted] = /^Revert "(.*)"$/.exec(subject) ?? [];
    return named.some(hash => brought.some(commit => commit.startsWith(hash))) || (quoted !== undefined && plainTitle(quoted) === title);
  };
  return (await revertsAfter(place, sha)).find(namesIt)?.hash ?? null;
}

async function pushedAtOf({ repo, base, origin }, { pushedAt, mergedAt, sha }, now) {
  if (pushedAt || !origin) return pushedAt ?? mergedAt;
  return await isMerged(repo, sha, `refs/remotes/origin/${base}`) ? iso(now) : null;
}

/** A pass stays a pass, and a project with no remote has nobody to ask. */
async function ciNow(place, { sha, ci }, gh) {
  if (!place.origin) return 'none';
  return ci === 'passing' ? ci : ciOn(place, sha, gh);
}

/** All the waiting for one launch. It decides nothing, so a slow `gh` cannot leave a decision resting on what has changed since. */
async function readLaunch(place, launch, title, { now, gh }) {
  const { sha, stage, files } = launch;
  const revert = await revertOf(place, launch, title);
  if (stage === 'closed') return { revert };

  const pushedAt = await pushedAtOf(place, launch, now);
  const touched = files ? [] : await filesOf(place.repo, sha);
  return {
    revert,
    pushedAt,
    ...(touched.length ? { files: touched } : {}),
    ...(pushedAt ? { ci: await ciNow(place, launch, gh) } : {}),
  };
}

function changesTo(launch, fields) {
  return Object.fromEntries(Object.entries(fields).filter(([field, value]) => value !== undefined && value !== (launch[field] ?? null)));
}

const suspicious = ({ ci, health }) => ci === 'failing' || health === 'down';
const readClean = ({ ci, health }) => ['passing', 'none'].includes(ci) && !['down', 'gap'].includes(health);

/** When a launch can close. It takes 48 hours live, or since the push when nothing can say it went live, and a watched one takes exposure too. */
function closingTime(launch, watched) {
  const limit = Date.parse(launch.pushedAt) + MOST_WATCHED_MS;
  const baked = Date.parse(launch.liveAt ?? launch.pushedAt) + LIVE_FOR_MS;
  return !watched || (launch.liveAt && launch.exercised > 0) ? Math.min(limit, baked) : limit;
}

/** A gap or a failing check holds a launch open, and at the limit it ends with no credit, because only a clean read earns any. */
function outcomeOf(launch, { watched, reached }, now) {
  if (now < closingTime(launch, watched)) return null;
  const clean = reached && readClean(launch);
  if (!clean && now < Date.parse(launch.pushedAt) + MOST_WATCHED_MS) return null;
  if (!clean) return 'unexercised';
  if (!watched) return 'quiet';
  return launch.exercised > 0 ? 'held' : 'unexercised';
}

const onlyDocs = ({ landed }, files = []) => (landed?.area ? landed.area === 'docs' : files.length > 0 && files.every(file => /\.md$/i.test(file)));

function fileFlagRemoval(root, slug, { title, launch: { flag: { name, expires } } }, now) {
  return fileItem(root, slug, {
    key: `flag:remove:${name}`,
    kind: 'chore',
    title: `Remove the ${name} flag`,
    brief: `The watch on "${title}" closed clean, so the ${name} flag has done its job, and it expires on ${expires}. Remove the flag and the path it kept off, keep what shipped, and prove it with the project's tests.`,
    impact: 'low',
    effort: 'small',
  }, now);
}

function closeLaunch(root, slug, launch, item, outcome, now) {
  recordLaunch(root, slug, { item: launch.item, stage: 'closed', outcome, closesAt: iso(now) }, now);
  recordEvent(root, 'launch_closed', { project: slug, item: launch.item, outcome }, now);
  const clean = cleanOutcomes.includes(outcome);
  return { item: launch.item, outcome, filed: clean && item.launch?.flag ? [fileFlagRemoval(root, slug, item, now)] : [] };
}

function troubleBrief({ title, launch = {} }, { sha }, why) {
  const { risk, lookAt, undo, how } = launch;
  return [
    `"${title}" merged as ${sha?.slice(0, SHORT_SHA)} and went wrong: ${why}`,
    risk && `Its review named this risk: ${risk}`,
    lookAt && `Look first at ${lookAt}.`,
    undo && `It said this undoes it: ${[undo, how].filter(Boolean).join(', ')}.`,
    'Fix forward if that is small and safe, and otherwise prepare a revert branch. Prove it with a check that fails now, and say in your summary what the user has to do to ship it.',
    'You never deploy, roll back or revert the default branch.',
  ].filter(Boolean).join(' ');
}

/** One fix for one merge, whoever saw it first. A fix that named the merge is already that fix. */
function fileFix(root, slug, item, launch, why, now) {
  if (readItems(root, slug).some(({ causedBy }) => causedBy === item.id)) return null;
  return fileItem(root, slug, {
    key: `trouble:${item.id}`,
    kind: 'fix',
    urgent: true,
    causedBy: item.id,
    title: `Fix what "${item.title}" broke`,
    brief: troubleBrief(item, launch, why),
    impact: 'high',
    effort: 'small',
  }, now);
}

/** A launch that went wrong stops being watched and stays on record, and the pattern reads this to start again. */
function recordTrouble(root, slug, launch, item, { why, severe = false, seen = {} }, now) {
  const at = iso(now);
  const stillOpen = launch.stage !== 'closed';
  recordLaunch(root, slug, {
    item: item.id,
    ...seen,
    stage: 'closed',
    outcome: 'trouble',
    note: why,
    troubleAt: at,
    ...(stillOpen ? { closesAt: at } : {}),
    ...(severe ? { severe } : {}),
  }, now);
  return fileFix(root, slug, item, launch, why, now);
}

function troubleSeen({ item }, { revert }, items) {
  if (revert) return `Reverted by ${revert.slice(0, SHORT_SHA)}.`;
  const fix = items.find(({ causedBy }) => causedBy === item);
  return fix ? `"${fix.title}" names this change as its cause.` : null;
}

function moveLaunch(launch, reading, health, now) {
  const { pushedAt, ci, files } = reading;
  const read = {
    ...launch,
    ...(pushedAt && launch.stage === 'merged' ? { stage: 'pushed', pushedAt } : {}),
    ...(files ? { files } : {}),
    ci,
    ...(pushedAt && health ? { health } : {}),
  };
  const suspected = pushedAt && suspicious(read);
  return { ...read, suspectedAt: suspected ? launch.suspectedAt ?? iso(now) : null };
}

function settleOne({ root, slug, items, signals, health, reached, now }, launch, reading) {
  const item = itemWithId(items, launch.item);
  const why = launch.outcome === 'trouble' ? null : troubleSeen(launch, reading, items);
  if (why) {
    const fix = recordTrouble(root, slug, launch, item, { why }, now);
    return { trouble: [{ slug, item: launch.item, why }], filed: fix ? [fix] : [] };
  }
  if (launch.stage === 'closed') return {};

  const read = moveLaunch(launch, reading, health, now);
  const change = changesTo(launch, read);
  if (Object.keys(change).length) recordLaunch(root, slug, { item: launch.item, ...change }, now);
  const outcome = onlyDocs(item, read.files) ? 'quiet' : read.pushedAt && outcomeOf(read, { watched: canWatch(signals), reached }, now);
  if (!outcome) return {};

  const { filed, ...closed } = closeLaunch(root, slug, read, item, outcome, now);
  return { closed: [{ slug, ...closed }], filed };
}

/** Read fresh after all the waiting, with no wait before the writes, so a report a run sent meanwhile counts. */
function settleLaunches(root, slug, readings, facts) {
  const context = { root, slug, items: readItems(root, slug), ...facts };
  return readLaunches(root, slug).filter(({ item }) => readings.has(item)).map(launch => settleOne(context, launch, readings.get(launch.item)));
}

async function placeOf(repo) {
  // `gitOrNothing` hears a missing folder as an empty repository, which would pass for one with no reverts.
  if (!await gitOrNothing(repo, 'rev-parse', '--git-dir')) throw Error(`Cannot read ${repo}.`);
  const base = await defaultBranch(repo);
  const origin = await gitOrNothing(repo, 'remote', 'get-url', 'origin');
  // Without this a merge on GitHub, or a push from elsewhere, stays out of sight. It changes no branch and no file, and failing leaves what was last fetched.
  const reached = !origin || await gitToFetch(repo, '-c', 'gc.auto=0', 'fetch', '--quiet', 'origin').then(() => true, () => false);
  const refs = [`refs/heads/${base}`, `refs/remotes/origin/${base}`];
  const known = await Promise.all(refs.map(ref => gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', ref)));
  return { repo, base, origin, reached, tips: refs.filter((_ref, index) => known[index]) };
}

async function pulseProject(root, { slug, path }, { now, gh, fetchPage }) {
  openNew(root, slug, now);
  const watched = readLaunches(root, slug).filter(launch => stillWatched(launch, now));
  if (!watched.length) return [];

  const place = await placeOf(path ?? paths(root, slug).clone);
  const items = readItems(root, slug);
  const readings = new Map();
  // One at a time, because a survey already runs through every project in turn.
  for (const launch of watched) readings.set(launch.item, await readLaunch(place, launch, itemWithId(items, launch.item).title, { now, gh }));

  const signals = readSignals(root, slug);
  const anyPushed = [...readings.values()].some(({ pushedAt }) => pushedAt);
  const health = anyPushed ? await healthOf(signals?.health?.url, fetchPage) : null;
  return settleLaunches(root, slug, readings, { signals, health, reached: place.reached, now });
}

/**
 * What became of what landed, every half hour with the survey, mode on or off and with no model. It runs `git`, `gh` and one GET, and never a command an agent wrote,
 * because a project's text could reach one. What fails to answer is a gap: it never reads as clean, and a launch holds until it can be read or its limit comes.
 * With `only`, a project's slug, it reads that project's launches alone.
 */
export async function pulseLaunches(root, { now = Date.now(), gh = defaultGh, fetch: fetchPage = globalThis.fetch, only = null } = {}) {
  const found = [];
  for (const project of chosenProjects(root).filter(({ slug }) => !only || slug === only)) {
    // A repository that cannot be read today is a gap too, and the rest still get their pulse.
    found.push(...await pulseProject(root, project, { now, gh, fetchPage }).catch(() => []));
  }
  const allOf = field => found.flatMap(settled => settled[field] ?? []);
  return { closed: allOf('closed'), trouble: allOf('trouble'), filed: allOf('filed') };
}

function assertSeen({ item, exercised, newErrors = [] }, open, slug) {
  if (!open.some(launch => launch.item === item)) throw Error(`${item} is not an open launch on ${slug}. hobkin work watching lists them.`);
  if (exercised != null && (!Number.isInteger(exercised) || exercised < 0)) throw Error('exercised must be how many requests reached the change.');
  if (!Array.isArray(newErrors)) throw Error('newErrors must be a list of the error classes that are new since the merge.');
}

function seenByRun(launch, { live, exercised, note }, now) {
  return {
    ...(live && launch.stage === 'pushed' ? { stage: 'live', liveAt: iso(now) } : {}),
    // Logs roll over, so a later look can see fewer requests than an earlier one did.
    ...(exercised != null ? { exercised: Math.max(exercised, launch.exercised ?? 0) } : {}),
    ...(note ? { note: String(note).slice(0, MOST_NOTE_LENGTH) } : {}),
  };
}

/** What a watch look found, one entry for each launch. A run says what it saw, so `stage`, `outcome` and the rest stay in code's hands. */
export function recordWatch(root, slug, report, now = Date.now()) {
  if (!Array.isArray(report?.launches)) throw Error('Send { "launches": [...] } with one entry for each open launch.');
  const open = openLaunches(readLaunches(root, slug));
  for (const found of report.launches) assertSeen(found, open, slug);

  const items = readItems(root, slug);
  const trouble = report.launches.flatMap(found => {
    const launch = open.find(({ item }) => item === found.item);
    const seen = seenByRun(launch, found, now);
    if (!found.newErrors?.length) {
      recordLaunch(root, slug, { item: found.item, ...seen }, now);
      return [];
    }
    const why = [`New errors: ${found.newErrors.join(', ')}.`, seen.note].filter(Boolean).join(' ').slice(0, MOST_NOTE_LENGTH);
    recordTrouble(root, slug, launch, itemWithId(items, found.item), { why, severe: Boolean(found.severe), seen }, now);
    return [found.item];
  });
  return { recorded: report.launches.length, trouble };
}

/** The user's word, which needs no proof and no open launch. A merge no pulse has reached yet gets its launch here. */
export function userTrouble(root, slug, item, { why = 'The user said so.', severe = false }, now = Date.now()) {
  openNew(root, slug, now);
  const launch = readLaunches(root, slug).find(({ item: id }) => id === item.id);
  if (!launch) throw Error(`"${item.title}" has not landed, so nothing can have gone wrong with it.`);
  return recordTrouble(root, slug, launch, item, { why, severe }, now);
}

/** The next watch look on a project: an hour after a push, 12 hours after the last look, and at once when the pulse suspects trouble. */
export function watchDue(launches, lastWatchAt, now) {
  const last = lastWatchAt ? Date.parse(lastWatchAt) : 0;
  const pushed = openLaunches(launches).filter(({ pushedAt }) => pushedAt);
  const dueAt = ({ pushedAt }) => (last > Date.parse(pushedAt) ? last + LOOK_EVERY_MS : Date.parse(pushedAt) + FIRST_LOOK_AFTER_MS);
  const suspected = pushed.some(({ suspectedAt }) => suspectedAt && Date.parse(suspectedAt) > last);
  return { suspected, due: suspected || pushed.some(launch => dueAt(launch) <= now) };
}

/** What has been seen of a launch so far, in words. */
export function knownSoFar({ stage, ci, health, exercised, note }) {
  const facts = [
    stage === 'merged' && 'not on origin yet',
    ciWords[ci],
    healthWords[health],
    exercised > 0 && `${exercised} ${exercised === 1 ? 'request' : 'requests'}`,
    note,
  ].filter(Boolean);
  return facts.length ? facts.join(' · ') : 'nothing yet';
}

export const launchSince = ({ liveAt, pushedAt, mergedAt }) => liveAt ?? pushedAt ?? mergedAt;

/** What a watch look reads: every open launch on one project, and how that project shows what is live. */
export function watchBrief(root, slug) {
  const items = readItems(root, slug);
  const launches = openLaunches(readLaunches(root, slug)).map(launch => {
    const { item: id, sha, files = [], stage, mergedAt, ci = null, health = null, exercised = null, note = null } = launch;
    const { title, launch: review = null } = itemWithId(items, id);
    return { item: id, title, sha, files, stage, since: launchSince(launch), mergedAt, ci, health, exercised, note, review };
  });
  return { launches, signals: readSignals(root, slug) };
}
