import { createHash } from 'node:crypto';

const TEST_PATH = /(^|\/)(tests?|specs?|__tests__|e2e)\/|[._-](test|spec)\.[^/]+$/i;
const DOC_PATH = /(^|\/)docs?\/|\.(md|mdx|rst|adoc)$/i;
const DEPENDENCY_PATH = /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|gemfile(\.lock)?|go\.(mod|sum)|cargo\.(toml|lock)|requirements[^/]*\.txt|poetry\.lock|uv\.lock|pyproject\.toml|composer\.(json|lock)|pubspec\.(yaml|lock)|podfile\.lock)$/i;
// A word inside a name is enough here, because a false match only means the normal walk.
const SENSITIVE_PATH = /migrat|schema|auth|session|token|secret|credential|password|payment|billing|deploy|kamal|dockerfile|docker-compose|fly\.toml|procfile|vercel\.json|netlify\.toml|render\.ya?ml|\.github\/|\.gitlab-ci|\.circleci|jenkinsfile|(^|\/)ci\//i;
const MOST_AREAS = 2;
const HALF_LIFE_MS = 90 * 24 * 3600000;
const DAY_MS = 24 * 3600000;
const EARNED_WEIGHT = 8;
const MOST_LINES_OFFERED = 300;
const SPOT_ONE_IN = 5;
const WEIGHT_PLACES = 100;
const outcomeWeights = { held: 1, quiet: 0.5, unexercised: 0 };
const OUTCOME_COUNTS = ['held', 'quiet', 'unexercised', 'watching'];
// Changes of these read much the same in any project, so only these take a precedent from another one.
const TRAVELLING_AREAS = ['docs', 'tests', 'deps'];
const NO_WAY_BACK = ['one-way', 'permanent'];
const gapWords = {
  elsewhere: 'already on another branch',
  stacked: 'sits under a newer branch',
  closing: 'an agent is on it',
  yours: 'only a person can do this',
  unlanded: 'its item says done, so it goes through the walk',
};

export const isTestPath = path => TEST_PATH.test(path);

const areaOfPath = path => {
  if (DEPENDENCY_PATH.test(path)) return 'deps';
  return path.split('/').slice(0, -1).slice(0, MOST_AREAS).join('/') || 'root';
};

function linesByArea(files) {
  const lines = new Map();
  for (const { path, lines: changed } of files) {
    const area = areaOfPath(path);
    lines.set(area, (lines.get(area) ?? 0) + changed);
  }
  return lines;
}

/**
 * Where a change sits, from each file's path and changed lines. Tests and docs follow the code they sit beside, so they only name a branch that touches nothing
 * else. Both at once match neither, and `multi` gets no offer, as a branch past two areas gets none.
 */
export function areaOf(files) {
  if (!files.length) return null;
  const code = files.filter(({ path }) => !TEST_PATH.test(path) && !DOC_PATH.test(path));
  if (!code.length) {
    if (files.every(({ path }) => DOC_PATH.test(path))) return 'docs';
    return files.every(({ path }) => TEST_PATH.test(path)) ? 'tests' : 'multi';
  }
  const areas = [...linesByArea(code)].toSorted(([firstName, first], [secondName, second]) => second - first || firstName.localeCompare(secondName));
  return areas.length > MOST_AREAS ? 'multi' : areas[0][0];
}

/** Kind plays the part of a runbook, because each lens files its own kind. With no area there is no pattern, so that change counts for nothing either way. */
export const patternOf = ({ slug, kind, area }) => (area ? `${slug}/${kind}/${area}` : null);

const partsOf = pattern => {
  const [slug, kind, ...area] = pattern.split('/');
  return { slug, kind, area: area.join('/') };
};

const blankRecord = ({ slug, kind, area }) => ({
  pattern: patternOf({ slug, kind, area }),
  slug,
  kind,
  area,
  merged: 0,
  held: 0,
  quiet: 0,
  unexercised: 0,
  watching: 0,
  weight: 0,
  weighedAt: 0,
  latest: null,
  troubleAt: null,
  severeAt: null,
});

/** Halving is continuous, so weighing a record at each event gives the same answer as weighing every landing at the end, and a no can floor it as it happens. */
function weighed(record, at, change = 0) {
  const decayed = record.weight * 0.5 ** ((at - record.weighedAt) / HALF_LIFE_MS);
  return { ...record, weight: Math.max(0, decayed + change), weighedAt: at };
}

function latestFrom({ item: { id, title, landed }, launch }) {
  const closed = launch?.outcome && Date.parse(launch.updatedAt ?? '');
  const days = closed ? Math.round((closed - Date.parse(landed.at)) / DAY_MS) : null;
  return { id, title, at: landed.at, outcome: launch?.outcome ?? null, days };
}

const applying = {
  landed(record, event) {
    const outcome = event.launch?.outcome ?? 'watching';
    const counted = OUTCOME_COUNTS.includes(outcome) ? { [outcome]: record[outcome] + 1 } : {};
    return {
      ...weighed(record, event.at, outcomeWeights[outcome] ?? 0),
      ...counted,
      merged: record.merged + 1,
      latest: latestFrom(event),
    };
  },
  pushback: (record, { at }) => weighed(record, at, -1),
  trouble: (record, { at, severe }) => ({ ...blankRecord(record), troubleAt: at, severeAt: severe ? at : record.severeAt }),
};

function landingEvents(slug, item, launch) {
  const { kind, landed } = item;
  const change = { slug, kind, area: landed.area };
  const landing = { ...change, type: 'landed', at: Date.parse(landed.at), item, launch };
  if (launch?.outcome !== 'trouble') return [landing];
  // Trouble resets what came before it, and it can come days after later changes landed.
  const trouble = { ...change, type: 'trouble', at: Date.parse(launch.updatedAt ?? landed.at), severe: Boolean(launch.severe) };
  return [landing, trouble];
}

function eventsOf({ slug, items, launches }) {
  const launchOf = new Map(launches.map(launch => [launch.item, launch]));
  return items.flatMap(item => [
    ...(item.landed ? landingEvents(slug, item, launchOf.get(item.id)) : []),
    ...(item.pushbacks ?? []).map(({ at, area }) => ({ type: 'pushback', at: Date.parse(at), slug, kind: item.kind, area })),
  ]);
}

function whyOff({ severeAt }, switched) {
  if (switched?.on === false) return 'user';
  const turnedBackOn = switched?.on && Date.parse(switched.at) > severeAt;
  return severeAt !== null && !turnedBackOn ? 'severe' : null;
}

function finished(record, switched, now) {
  const { weight } = weighed(record, now);
  return { ...record, weight: Math.round(weight * WEIGHT_PLACES) / WEIGHT_PLACES, off: whyOff(record, switched) };
}

/**
 * What each pattern has earned, as a map by pattern. `projects` is `[{ slug, items, launches }]`, and `trust` is the user's switches, `[{ pattern, on, at }]`.
 * It learns from what happened after a merge and never from the yes. A landed change is exposure, and its outcome is the label.
 */
export function trackRecords(projects, trust = [], now = Date.now()) {
  const records = new Map(trust.map(({ pattern }) => [pattern, blankRecord(partsOf(pattern))]));
  const events = projects.flatMap(eventsOf)
    .filter(({ area }) => area)
    .toSorted((first, second) => first.at - second.at);
  for (const event of events) {
    const pattern = patternOf(event);
    records.set(pattern, applying[event.type](records.get(pattern) ?? blankRecord(event), event));
  }
  const switches = new Map(trust.map(switched => [switched.pattern, switched]));
  return new Map([...records].map(([pattern, record]) => [pattern, finished(record, switches.get(pattern), now)]));
}

const tierOf = record => {
  if (!record?.merged) return 'new';
  return record.weight >= EARNED_WEIGHT ? 'earned' : 'seen';
};

const hasHistory = record => Boolean(record?.merged || record?.troubleAt);

/** A project's own record speaks first, and any trouble there stands: a clean record elsewhere cannot wash it out. */
function precedentFor(records, own, { slug, kind, area }) {
  if (hasHistory(own) || !TRAVELLING_AREAS.includes(area)) return own;
  const sameChangeElsewhere = record => record.slug !== slug && record.kind === kind && record.area === area;
  const others = [...records.values()].filter(record => sameChangeElsewhere(record) && record.merged && !record.off);
  return others.toSorted((first, second) => second.weight - first.weight)[0] ?? own;
}

const isSafeA = ({ safety, onlyDocs }) => onlyDocs || (safety?.grade === 'safe' && safety.rating === 'A' && !safety.stale);

// No review reads a branch of markdown alone, so there is no grade to ask of it.
function gradeVetoes({ safety, sha, onlyDocs }, { quality }) {
  if (onlyDocs) return [];
  return [
    !safety && 'no safety grade',
    safety?.stale && 'its safety grade is on an older commit',
    safety && (safety.grade !== 'safe' || safety.rating !== 'A') && 'below safe A',
    !quality && 'no quality grade',
    quality && quality.head !== sha && 'its quality grade is on an older commit',
    quality && !['A', 'B'].includes(quality.rating) && 'quality below B',
  ];
}

function changeVetoes({ area, conflict, size, paths = [], deletedTests = [] }) {
  const lines = (size?.additions ?? 0) + (size?.deletions ?? 0);
  const sensitive = paths.find(path => SENSITIVE_PATH.test(path));
  return [
    !area && 'the survey has not read this branch yet',
    area === 'multi' && 'touches too many areas',
    lines > MOST_LINES_OFFERED && `over ${MOST_LINES_OFFERED} changed lines`,
    (size?.files ?? 0) > paths.length && 'too many files to read',
    conflict !== false && 'a conflict, or no way to tell',
    deletedTests.length > 0 && 'deletes tests',
    sensitive && `touches ${sensitive}`,
  ];
}

const vetoesOf = ({ item, unit, gap, beneath }) => [
  gapWords[gap],
  ...gradeVetoes(unit, item),
  ...changeVetoes(unit),
  !item.proof && 'no proof',
  item.left && 'something is left for the user',
  NO_WAY_BACK.includes(item.launch?.undo) && `undo is ${item.launch.undo}`,
  !beneath.every(isSafeA) && 'brings earlier work below safe A with it',
].filter(Boolean);

function historyVetoes(record, own, pattern) {
  if (own?.off === 'user') return ['turned off with hobkin work trust'];
  if (own?.off === 'severe') return [`turned off by severe trouble, until hobkin work trust ${pattern} on`];
  if (record?.merged) return [];
  return [record?.troubleAt ? 'trouble reset this pattern' : 'no landed precedent'];
}

const isSpotCheck = id => createHash('sha256').update(String(id)).digest().readUInt32BE(0) % SPOT_ONE_IN === 0;

/**
 * What one finished branch can be offered, and why not. `unit` is what the survey says of its branch, and `beneath` the branches it would bring with it.
 * A spot check qualifies and still goes through the normal walk, with no precedent to lean on, so hobkin can compare what offers cost.
 */
export function offerFor({ slug, item, unit = {}, gap, records, beneath = [] }) {
  const { kind, id } = item;
  const { area } = unit;
  const pattern = patternOf({ slug, kind, area });
  const own = records.get(pattern) ?? null;
  const record = precedentFor(records, own, { slug, kind, area });
  const why = [...(area ? historyVetoes(record, own, pattern) : []), ...vetoesOf({ item, unit, gap, beneath })];
  const spot = !why.length && isSpotCheck(id);
  return {
    pattern,
    tier: tierOf(record),
    offerable: !why.length && !spot,
    spot,
    why: spot ? ['a spot check, so it goes through the normal walk'] : why,
    precedent: spot || !record?.merged ? null : record,
  };
}
