import { postClientNotice } from '../client-notices.mjs';
import { answerDecision, fileDecision, latestAnswer, openDecisions } from '../decisions.mjs';
import { findProject, nameOf } from './names.mjs';
import { paths, readItems, readProjects, updateItem } from './store.mjs';
import { defaultBranch } from './tree.mjs';
import { landingTip, SHIP_KIND } from './unmerged.mjs';
import { readinessOf } from './yolo.mjs';

/**
 * A merge is not the end of work on a project that deploys: the work is done once the deploy that carries it is live and watched. Each merge
 * there waits for that deploy on its item, as `deploy`. hobkin asks "Deploy now?" once a project, listing what merged since its last deploy, and
 * keeps that one question up to date as more merges land. The user's yes hands the main agent the deploy, with the live check and the watch
 * after it, and the reading it pipes back says whether the deploy held. A merge YOLO mode handed on is that mode's own (`yolo-pass.mjs`). The
 * issues close in the pass after a merge (`after-merge.mjs`), once the deploy that carried them held. Code never deploys.
 */

// How long a deploy is watched before its monitoring is called calm.
export const AFTER_DEPLOY_MINUTES = 30;
export const READINGS = ['errors', 'slowQueries', 'latency'];
const KEY = 'deploy';
const SHORT_SHA = 7;
const LONGEST_LINE = 400;
const LONGEST_TITLE = 70;
const MOST_LISTED = 12;
// What waits for the next deploy: merged since the last one, or carried by one that regressed, which a calm deploy has to carry again.
const TO_DEPLOY = ['waiting', 'regressed'];
const groupWords = { fix: 'Fixes', security: 'Fixes', 'pr-fix': 'Fixes', attention: 'Fixes', feature: 'Features', update: 'Updates', improvement: 'Improvements' };

// Titles come from agents, and these reach the terminal.
const plain = text => String(text ?? '').replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim();
const shortTitle = title => (title.length > LONGEST_TITLE ? `${title.slice(0, LONGEST_TITLE - 1).trimEnd()}…` : title);
const quoted = ({ title }) => `"${shortTitle(plain(title))}"`;
const changes = count => `${count} ${count === 1 ? 'change' : 'changes'}`;
const isOneLine = text => typeof text === 'string' && text.trim().length > 0 && text.length <= LONGEST_LINE && !/[\r\n]/.test(text.trim());
const timeAt = now => new Date(now).toISOString();
const deployKey = slug => `${KEY}:${slug}`;
const issueNamed = ({ issue }) => `${issue.repo}#${issue.number}`;
const listed = names => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

/** How a project deploys and how a deploy is taken back, from its readiness record, or null when it does not deploy or its path is not known. */
export function deployPathOf(root, slug) {
  const { deploy, rollback } = readinessOf(root, slug).parts;
  if (deploy.state !== 'done' || deploy.deploys === false) return null;
  return { path: deploy.line, back: rollback.line };
}

/**
 * Where a merge's deploy stands, marking it as waiting for one on a project that deploys. Null when its project does not deploy, so its issue
 * closes at merge. Work that only fixes another branch's way to merge is that branch's, and rides with it.
 */
export function awaitDeploy(root, { slug }, item, now = Date.now()) {
  if (item.deploy) return item.deploy;
  if (item.kind === SHIP_KIND || !deployPathOf(root, slug)) return null;
  const deploy = { state: 'waiting', at: timeAt(now) };
  updateItem(root, slug, item.id, { deploy }, now);
  return deploy;
}

const newestFirst = items => items.toSorted((first, second) => String(second.mergedAt ?? '').localeCompare(String(first.mergedAt ?? '')));

/** The groups of a question, each newest first, and the group with the newest change first. */
function groupLines(items) {
  const shown = items.slice(0, MOST_LISTED);
  const groups = Map.groupBy(shown, ({ kind }) => groupWords[kind] ?? 'Other changes');
  const named = item => (item.issue ? `${quoted(item)} (${issueNamed(item)})` : quoted(item));
  const lines = [...groups].map(([group, each]) => `${group}: ${each.map(named).join(', ')}.`);
  const more = items.length - shown.length;
  return more > 0 ? [...lines, `And ${changes(more)} more.`] : lines;
}

function deployAsk(project, items, { path }) {
  const name = plain(nameOf(project));
  return {
    key: deployKey(project.slug),
    from: 'Work mode',
    question: [
      `${name} has ${changes(items.length)} merged since its last deploy, newest first.`,
      ...groupLines(items),
      `Deploy now hands the deploy to the main agent: ${path} It checks it live, watches the monitoring for ${AFTER_DEPLOY_MINUTES} minutes, and then closes their issues. Not now keeps them open.`,
    ].join('\n'),
    tldr: `Deploy now? ${changes(items.length)} merged on ${name}`,
    choices: [{ value: 'later', label: 'Not now' }, { value: 'deploy', label: 'Deploy now' }],
    recommended: 'deploy',
    why: 'Merged work is done once it is live and watched.',
    answerTo: { kind: KEY, slug: project.slug, items: items.map(({ id }) => id) },
  };
}

const sameList = (first = [], second = []) => first.length === second.length && first.every((id, index) => id === second[index]);

// The user already answered for every change merged since: a later answer than theirs comes only with a merge they have not seen.
const answeredFor = (root, slug, fresh) => {
  const answered = latestAnswer(root, deployKey(slug))?.answerTo?.items ?? [];
  return fresh.every(({ id }) => answered.includes(id));
};

/**
 * One "Deploy now?" a project, filed when a merge waits for a deploy, and brought up to date while it is open as more merges land, rather than
 * filed again. A question with nothing new to deploy, or on a project that no longer deploys, is retired. After "Not now" it comes back only
 * with a merge the user has not been asked about. It writes only when the list changes, so a pass that finds nothing new writes nothing.
 */
export function askToDeploy(root, now = Date.now()) {
  const open = new Map(openDecisions(root).filter(({ answerTo }) => answerTo?.kind === KEY).map(decision => [decision.answerTo.slug, decision]));
  for (const project of readProjects(root)) {
    const asked = open.get(project.slug);
    const items = newestFirst(readItems(root, project.slug).filter(item => item.state === 'merged' && TO_DEPLOY.includes(item.deploy?.state)));
    const fresh = items.filter(({ deploy }) => deploy.state === 'waiting');
    const known = asked ? sameList(asked.answerTo.items, items.map(({ id }) => id)) : answeredFor(root, project.slug, fresh);
    if (fresh.length && known) continue;

    const path = fresh.length ? deployPathOf(root, project.slug) : null;
    if (path) fileDecision(root, deployAsk(project, items, path), now);
    else if (asked) answerDecision(root, asked.id, 'later', now);
  }
}

/** Marks the changes a yes covers as deploying at the default branch's tip, and answers that commit. */
async function markDeploying(root, project, going, { handedAt, now }) {
  const repo = project.path ?? paths(root, project.slug).clone;
  const commit = await landingTip(repo, await defaultBranch(repo));
  if (!commit) throw Error(`${nameOf(project)} has no default branch to deploy, so nothing was handed on.`);
  for (const item of going) updateItem(root, project.slug, item.id, { deploy: { state: 'deploying', by: 'yes', commit, at: timeAt(now), handedAt } }, now);
  return commit;
}

function assertDeploys(root, project) {
  const path = deployPathOf(root, project.slug);
  if (!path) throw Error(`${nameOf(project)} has no deploy path recorded, so nothing was handed on. Its readiness work records one.`);
  return path;
}

/**
 * The user's answer to "Deploy now?". A yes marks exactly the changes it listed that still wait, at the default branch's tip, and the next pass
 * after merges hands that deploy to the main agent. Not now leaves them waiting, with their issues open.
 */
export async function answerDeploy(root, value, { slug, items: listedIds = [] }, now = Date.now()) {
  const project = findProject(root, slug);
  const name = nameOf(project);
  if (value !== 'deploy') {
    return { ok: true, message: `The changes on ${name} stay merged and waiting for a deploy, and their issues stay open. hobkin asks again once more merges land.` };
  }
  assertDeploys(root, project);
  const going = readItems(root, slug).filter(item => listedIds.includes(item.id) && TO_DEPLOY.includes(item.deploy?.state));
  if (!going.length) return { ok: true, message: `Nothing listed on ${name} still waits for a deploy, so nothing was handed on.` };

  const commit = await markDeploying(root, project, going, { handedAt: null, now });
  return { ok: true, message: `The main agent deploys ${changes(going.length)} on ${name} at ${commit.slice(0, SHORT_SHA)} next. Their issues close once it is verified live.` };
}

/**
 * `hobkin work deploy <project>`, for the main agent when the user's own ask in Chat covers the deploy: everything that waits for one there,
 * including a merge the pass after merges has not followed yet, at the default branch's tip. It answers the open "Deploy now?" the same way, and
 * prints the job itself, since the main agent is the one asking. Only ever on the user's word.
 */
export async function deployNow(root, reference, now = Date.now()) {
  const project = findProject(root, reference);
  const path = assertDeploys(root, project);
  for (const item of readItems(root, project.slug).filter(({ state, afterMerge }) => state === 'merged' && afterMerge === 'due')) awaitDeploy(root, project, item, now);
  const going = readItems(root, project.slug).filter(item => item.state === 'merged' && TO_DEPLOY.includes(item.deploy?.state));
  if (!going.length) throw Error(`Nothing on ${nameOf(project)} waits for a deploy, so nothing was handed on.`);

  const commit = await markDeploying(root, project, going, { handedAt: timeAt(now), now });
  const asked = openDecisions(root).find(({ answerTo }) => answerTo?.kind === KEY && answerTo.slug === project.slug);
  if (asked) answerDecision(root, asked.id, 'deploy', now);
  const handOff = deployJob(project, commit, going, path);
  return { ok: true, message: `Deploy ${changes(going.length)} on ${nameOf(project)} at ${commit.slice(0, SHORT_SHA)}: hand the job in handOff to one session. Their issues close once its reading says it held.`, handOff };
}

/** The deploy the user said yes to, for the main agent to hand to one session, as it hands on the deploy of a merge YOLO mode made. */
function deployJob(project, commit, items, { path, back }) {
  const titles = newestFirst(items).map(quoted);
  return {
    project: nameOf(project),
    commit,
    items: newestFirst(items).map(({ id, title }) => ({ item: id, title })),
    title: `Deploy ${changes(items.length)} on ${nameOf(project)}`,
    asked: `The user said yes to deploying what merged on ${nameOf(project)} since its last deploy: ${titles.join(', ')}. `
      + `Deploy the default branch at exactly ${commit}, pushing it first if the deploy needs it there, by the project's recorded path: ${path} Its way back: ${back} `
      + 'Prove it live with the live revision, a real health check and a check that these changes work there, and deploy nothing else. '
      + `Then watch its monitoring for ${AFTER_DEPLOY_MINUTES} minutes and record what it showed: pipe `
      + '{ "live": "the live revision and what showed the changes working", "minutes": 30, "errors": { "regressed": false, "saw": "one line" }, '
      + '"slowQueries": { "regressed": false, "saw": "one line" }, "latency": { "regressed": false, "saw": "the figure against its baseline" } } '
      + `to hobkin work deployed ${project.slug} ${commit}. A regression is recorded the moment it shows, without waiting for the window to end. `
      + 'Between looks at the monitoring, wait with hobkin_wait and a note of what to look at next, never with a sleep in the shell. '
      + 'A reading the project has no monitoring for is { "notApplicable": "the reason" }, and with none at all it is recorded at once.',
    why: 'The user said yes to Deploy now? for exactly these changes',
  };
}

/** Each deploy the user said yes to goes to the main agent once, in one job for the commit it pins. */
export function handDeploys(root, handOff, now = Date.now()) {
  for (const project of readProjects(root)) {
    const unhanded = readItems(root, project.slug).filter(({ deploy }) => deploy?.state === 'deploying' && deploy.by === 'yes' && !deploy.handedAt);
    const path = unhanded.length ? deployPathOf(root, project.slug) : null;
    if (!path) continue;
    for (const [commit, items] of Map.groupBy(unhanded, ({ deploy }) => deploy.commit)) {
      handOff(deployJob(project, commit, items, path));
      for (const item of items) updateItem(root, project.slug, item.id, { deploy: { ...item.deploy, handedAt: timeAt(now) } }, now);
    }
  }
}

function oneReading(name, reading) {
  const { regressed, saw, notApplicable } = reading ?? {};
  if (typeof regressed === 'boolean' && isOneLine(saw)) return { regressed, saw: saw.trim() };
  if (isOneLine(notApplicable)) return { regressed: false, notApplicable: notApplicable.trim() };
  throw Error(`${name} needs regressed, true or false, with what the monitoring showed in a line as saw, or notApplicable with the reason.`);
}

/**
 * What the monitoring showed after a deploy: errors, slow queries and latency against its baseline. A regression counts the moment it shows. A
 * calm reading covers the whole window, unless the project has no monitoring for any of them, and then the live check is all there is. `live`,
 * what showed the deploy live, is a line, and `needsLive` makes it one the reading cannot leave out.
 */
export function readingFrom(sent, { needsLive = false } = {}) {
  if (!Number.isInteger(sent?.minutes) || sent.minutes < 0) throw Error('minutes is how long the monitoring was watched, as a whole number.');
  const after = { minutes: sent.minutes, ...Object.fromEntries(READINGS.map(name => [name, oneReading(name, sent[name])])) };
  if (isOneLine(sent.live)) after.live = sent.live.trim();
  else if (needsLive || sent.live !== undefined) throw Error('live is what showed the deploy live, in a line: the live revision and the check of the changes.');
  const regressed = READINGS.filter(name => after[name].regressed);
  const unmonitored = READINGS.every(name => after[name].notApplicable);
  if (!regressed.length && !unmonitored && after.minutes < AFTER_DEPLOY_MINUTES) {
    throw Error(`A reading with no regression covers the whole ${AFTER_DEPLOY_MINUTES} minutes. Record it once they have passed.`);
  }
  return { after, regressed, unmonitored };
}

/** What the readings in `names` saw, in their own words. */
export const sawIn = (after, names) => names.map(name => after[name].saw).filter(Boolean).join(' ');

/** Where a deploy leaves each change it carried: live, so its issue closes, or regressed, so it stays open and rides with the next deploy. */
export function deployHeld(root, slug, item, { after, regressed, unmonitored }, now = Date.now()) {
  const { by, commit } = item.deploy;
  const at = timeAt(now);
  const deploy = regressed.length
    ? { state: 'regressed', by, commit, at, why: sawIn(after, regressed) }
    : { state: 'live', by, commit, at, minutes: after.minutes, unmonitored, ...(after.live ? { live: after.live } : {}) };
  updateItem(root, slug, item.id, { deploy }, now);
}

/**
 * The reading after a deploy the user said yes to, piped by the session that deployed it, by the commit its job named. A calm one, or a live
 * check on a project with no monitoring, lets the next pass close the issues it carried. A regression is told at once as a problem: the issues
 * stay open, saying why, and the way back is named, since nothing rolls back by itself.
 */
export function recordDeployed(root, reference, commit, sent, now = Date.now()) {
  const project = findProject(root, reference);
  const name = nameOf(project);
  if (!/^[0-9a-f]{7,40}$/.test(commit ?? '')) throw Error('Say the commit the deploy put live, as its job named it.');
  const carried = readItems(root, project.slug).filter(({ deploy }) => deploy?.state === 'deploying' && deploy.commit.startsWith(commit));
  if (!carried.length) throw Error(`No deploy at ${commit} is with the main agent on ${name}, so there is nothing to record.`);

  const reading = readingFrom(sent, { needsLive: true });
  for (const item of carried) deployHeld(root, project.slug, item, reading, now);
  const { after, regressed, unmonitored } = reading;
  const full = carried[0].deploy.commit;
  const what = `${listed(newestFirst(carried).map(quoted))} on ${name} at ${full.slice(0, SHORT_SHA)}`;
  if (regressed.length) {
    const open = carried.filter(({ issue }) => issue).map(issueNamed);
    const staying = open.length ? ` ${listed(open)} ${open.length === 1 ? 'stays' : 'stay'} open.` : '';
    const back = deployPathOf(root, project.slug)?.back;
    const line = `Problem after deploying ${what}: ${sawIn(after, regressed)}${staying}${back ? ` The way back: ${back}` : ''}`;
    postClientNotice(root, { key: `deploy-problem:${project.slug}:${full}`, line, tone: 'critical' }, now);
    return { ok: true, message: line, regressed };
  }
  const line = unmonitored
    ? `The deploy of ${what} is live, with no monitoring to watch: ${after.live}`
    : `The deploy of ${what} held for ${after.minutes} minutes: ${sawIn(after, READINGS)}`;
  postClientNotice(root, { key: `deploy-held:${project.slug}:${full}`, line, tone: 'useful' }, now);
  return { ok: true, message: line, regressed };
}
