import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson } from './config.mjs';
import { routinesFolder } from './schedules.mjs';

/** What a person can be working toward in setup, in the order setup asks about them. The client keeps the same list. */
export const TEMPLATE_GOALS = ['job', 'business', 'project', 'life', 'code'];
/** What a routine made from a template gives the person. */
export const TEMPLATE_GIVES = ['report', 'action', 'critical', 'follow-up'];
/** The three cards setup starts each goal with. The rest of a goal's templates are its More. */
export const GOAL_STARTERS = {
  job: ['job-openings', 'job-applications', 'interviews'],
  business: ['business-leads', 'runway', 'competitors'],
  project: ['project-milestones', 'project-blockers', 'deadlines-ahead'],
  life: ['deadlines-ahead', 'email', 'money'],
  code: ['review-queue', 'dependency-watch', 'unblocker'],
};
// A template written before goals named a group, and a person's own may still. Each group reads as the goal it served.
const GROUP_GOALS = { day: 'life', week: 'life', life: 'life', code: 'code', machine: 'code' };
const EFFORTS = ['low', 'medium', 'high'];
const WHOLE_NUMBER = /^[1-9]\d*$/;
const REQUIRED = ['title', 'summary', 'recurrence', 'fits'];
// What a card shows and setup writes from. A person's own template may leave these out, and its card leaves out those rows.
const REQUIRED_OF_HOBKIN = [...REQUIRED, 'goals', 'tells', 'gives', 'closes'];
// A template is named for what it does. README.md, RULES.md or any other file named another way is about templates, not one.
const TEMPLATE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const LARGEST_TEMPLATE = 16384;

const shipped = fileURLToPath(new URL('../prompts/routine-templates/', import.meta.url));

/** Where the user's own templates go, beside their routines. The routine loader reads only its cadence folders, so these never run. */
export const yourTemplates = root => join(routinesFolder(root), 'templates');

/** The header is plain `key: value` lines between two `---` lines, so a person can write one by hand. */
function readHeader(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, '\n'));
  if (!match) throw Error('needs a header between two --- lines at the top');
  const header = {};
  for (const line of match[1].split('\n').filter(entry => entry.trim())) {
    const colon = line.indexOf(':');
    if (colon < 1) throw Error(`has a header line with no key: ${line.trim()}`);
    header[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return header;
}

const listOf = value => (value ? value.split(',').map(entry => entry.trim()).filter(Boolean) : []);

function oneOf(values, allowed, name) {
  const odd = values.find(value => !allowed.includes(value));
  if (odd) throw Error(`has the ${name} ${odd}, and ${name === 'output' ? 'an' : 'a'} ${name} is one of ${allowed.join(', ')}`);
  return values;
}

function goalsOf(header) {
  if (header.goals) return [...new Set(oneOf(listOf(header.goals), TEMPLATE_GOALS, 'goal'))];
  if (!header.group) return [];
  if (!GROUP_GOALS[header.group]) throw Error(`has the group ${header.group}, and a group is one of ${Object.keys(GROUP_GOALS).join(', ')}`);
  return [GROUP_GOALS[header.group]];
}

function privateOf(value = 'no') {
  if (!['yes', 'no'].includes(value)) throw Error(`has private: ${value}, and private is yes or no`);
  return value === 'yes';
}

/** One template file. hobkin's own must say what a card shows; a person's own needs only what setup matches on. */
export function readTemplate(file, source) {
  const stat = lstatSync(file);
  if (!stat.isFile()) throw Error('must be a regular file, not a link');
  if (stat.size > LARGEST_TEMPLATE) throw Error('is too large');
  const header = readHeader(readFileSync(file, 'utf8'));
  const missing = (source === 'hobkin' ? REQUIRED_OF_HOBKIN : REQUIRED).filter(key => !header[key]);
  if (missing.length) throw Error(`needs ${missing.join(', ')} in its header`);
  const effort = header.effort || 'medium';
  if (!EFFORTS.includes(effort)) throw Error(`has the effort ${effort}, and an effort is one of ${EFFORTS.join(', ')}`);
  const version = header.version || '1';
  if (!WHOLE_NUMBER.test(version)) throw Error(`has the version ${version}, and a version is a whole number from 1`);
  return {
    id: basename(file, '.md'),
    title: header.title,
    summary: header.summary,
    recurrence: header.recurrence,
    goals: goalsOf(header),
    needs: listOf(header.needs),
    effort,
    fits: header.fits,
    tells: header.tells || null,
    skips: header.skips || null,
    gives: oneOf(listOf(header.gives), TEMPLATE_GIVES, 'output'),
    closes: header.closes || null,
    private: privateOf(header.private),
    asks: header.asks || null,
    version: Number(version),
    file,
    source,
  };
}

function readFolder(folder, source) {
  const found = { templates: [], errors: [] };
  if (!existsSync(folder)) return found;
  for (const name of readdirSync(folder).filter(entry => TEMPLATE_NAME.test(entry))) {
    const file = join(folder, name);
    try {
      found.templates.push(readTemplate(file, source));
    } catch (error) {
      found.errors.push({ file, message: `${name} ${error.message}` });
    }
  }
  return found;
}

// By the goal each serves best, and a template under no goal last.
const goalPlace = ({ goals }) => (goals.length ? TEMPLATE_GOALS.indexOf(goals[0]) : TEMPLATE_GOALS.length);
const inMenuOrder = (first, second) => goalPlace(first) - goalPlace(second) || first.id.localeCompare(second.id);

const seenPath = root => join(root, 'runtime', 'templates-seen.json');

function readSeen(root) {
  try {
    return JSON.parse(readFileSync(seenPath(root), 'utf8')).seen ?? null;
  } catch {
    return null;
  }
}

/**
 * hobkin's own templates the user has not heard of yet, by name and version, from what an earlier open saw. A newer version is news too,
 * because a routine made from the old one does not change by itself. The first look only remembers, because setup offers them all anyway.
 * Templates of the user's own are never news, and what this returns is remembered as told.
 */
export function templateNews(root) {
  const shippedNow = readFolder(shipped, 'hobkin').templates;
  const seen = readSeen(root);
  const added = seen ? shippedNow.filter(({ id }) => seen[id] === undefined) : [];
  const updated = seen ? shippedNow.filter(({ id, version }) => seen[id] !== undefined && version > seen[id]) : [];
  if (!seen || added.length || updated.length) {
    const versions = Object.fromEntries(shippedNow.map(({ id, version }) => [id, version]));
    atomicJson(seenPath(root), { version: 1, seen: { ...seen, ...versions } });
  }
  return { added, updated };
}

const titlesOf = templates => {
  const titles = templates.map(({ title }) => title);
  return titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}` : titles[0];
};

/** One line for Chat about what an update brought, or null when it brought nothing. */
export function templateNotice({ added, updated }) {
  const parts = [
    added.length && `${added.length === 1 ? 'A new routine template' : `${added.length} new routine templates`}: ${titlesOf(added)}.`,
    updated.length && `Updated: ${titlesOf(updated)}.`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(' ')} Each waits in Action Items, and hobkin routines templates lists them all.` : null;
}

/**
 * What setup can offer: hobkin's templates and the user's own, one per name, with the user's winning. Adding one is adding a file.
 * A template that cannot be read is reported, not listed. `rules` go into every routine made from a template.
 */
export function listTemplates(root) {
  const own = readFolder(shipped, 'hobkin');
  const theirs = readFolder(yourTemplates(root), 'yours');
  const replaced = new Set(theirs.templates.map(({ id }) => id));
  return {
    rules: readFileSync(join(shipped, 'RULES.md'), 'utf8').trim(),
    templates: [...own.templates.filter(({ id }) => !replaced.has(id)), ...theirs.templates].toSorted(inMenuOrder),
    errors: [...own.errors, ...theirs.errors],
  };
}

/** What a card shows of a template, and what setup hands back to write it. Every part a template leaves out is null or empty. */
const cardOf = ({ id, version, source, title, summary, needs, recurrence, tells, skips, gives, closes, private: reads, asks, effort }) => ({
  id, version, source, title, summary, needs, recurrence, tells, skips, gives, closes, private: reads, asks, effort,
});

/**
 * The cards setup shows for the goals picked, in the order of TEMPLATE_GOALS, each goal with its starters and its More. A template is one
 * card in all of it: a starter under the first picked goal it starts, and any other under the first picked goal it names, best first. A
 * goal's More goes by where that goal stands in each template's goals, then by name. A goal nobody knows is left out.
 */
export function goalCards(root, goals) {
  const picked = TEMPLATE_GOALS.filter(goal => goals.includes(goal));
  const { templates } = listTemplates(root);
  const byId = new Map(templates.map(template => [template.id, template]));
  const startedUnder = new Map();
  for (const goal of picked) {
    for (const id of GOAL_STARTERS[goal]) if (byId.has(id) && !startedUnder.has(id)) startedUnder.set(id, goal);
  }
  const moreOf = goal => templates
    .filter(({ id, goals: named }) => !startedUnder.has(id) && named.find(entry => picked.includes(entry)) === goal)
    .toSorted((first, second) => first.goals.indexOf(goal) - second.goals.indexOf(goal) || first.id.localeCompare(second.id));
  return picked.map(goal => ({
    goal,
    starters: GOAL_STARTERS[goal].filter(id => startedUnder.get(id) === goal).map(id => cardOf(byId.get(id))),
    more: moreOf(goal).map(cardOf),
  }));
}
