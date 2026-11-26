import { finishedOnBranch } from './unmerged.mjs';

/**
 * A stack is finished branches built one on the other, read from the branches themselves: nothing has to be pushed and no PR has to exist. The
 * survey says which branch holds which (`heldBy`), and an item says which branches are finished, so this reads both and adds nothing to the survey.
 */

const LONGEST_NAME = 120;

/** What the maker said a stack is of, as one short line, or null when it said nothing. */
export function stackNameOf(text) {
  if (typeof text !== 'string') return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length <= LONGEST_NAME ? flat : `${flat.slice(0, LONGEST_NAME - 1).trimEnd()}…`;
}

const isLayer = item => Boolean(item.branch) && item.kind !== 'yours' && finishedOnBranch.includes(item.state);

/** One item for each branch: the first one stands for it, as the rows do. */
function itemsByBranch(items) {
  const byBranch = new Map();
  for (const item of items.filter(isLayer)) {
    if (!byBranch.has(item.branch)) byBranch.set(item.branch, item);
  }
  return byBranch;
}

const mostBuilt = (first, second) => second.ancestors.length - first.ancestors.length;

function placesOf(items, units) {
  const layers = itemsByBranch(items);
  const unitOf = branch => units.find(unit => unit.branch === branch);
  // A branch whose work is already on another branch is not waiting to land, so nothing is built on it that waits for it.
  const members = [...layers.keys()].filter(branch => !unitOf(branch)?.landedOn);
  const holds = (above, under) => Boolean(unitOf(under)?.heldBy?.includes(above));
  const beneath = branch => members.filter(other => other !== branch && holds(branch, other));
  const above = branch => members.filter(other => other !== branch && holds(other, branch));
  const lines = members.map(branch => ({ branch, ancestors: beneath(branch), over: above(branch) }));
  const lineOf = branch => lines.find(line => line.branch === branch);

  const rootOf = ({ branch, ancestors }) => {
    const bottom = ancestors.find(other => lineOf(other).ancestors.length === 0);
    return bottom ?? branch;
  };
  const rootOfEach = new Map(lines.map(line => [line.branch, rootOf(line)]));
  const stackOf = root => lines.filter(({ branch }) => rootOfEach.get(branch) === root);

  const named = root => {
    const bottomFirst = stackOf(root).toSorted((first, second) => first.ancestors.length - second.ancestors.length);
    return bottomFirst.map(({ branch }) => stackNameOf(layers.get(branch).stack)).find(Boolean) ?? null;
  };

  const places = new Map();
  for (const line of lines.filter(({ ancestors, over }) => ancestors.length || over.length)) {
    const root = rootOfEach.get(line.branch);
    const under = line.ancestors.map(lineOf).toSorted(mostBuilt)[0]?.branch ?? null;
    places.set(line.branch, {
      id: layers.get(root).id,
      layer: line.ancestors.length + 1,
      of: stackOf(root).length,
      name: named(root),
      below: under ? layers.get(under).id : null,
      base: under ? unitOf(under).sha ?? null : null,
    });
  }
  return places;
}

const remembered = new WeakMap();

/** The place of each finished branch that is in a stack, by branch name: `{ id, layer, of, name, below, base }`. A branch in no stack has none. */
export function stackPlaces(items, units) {
  const known = remembered.get(units);
  if (known?.items === items) return known.places;

  const places = placesOf(items, units);
  remembered.set(units, { items, places });
  return places;
}

/** The finished item directly under this one in its stack, which has to land first, or null for a bottom layer and for work in no stack. */
export function layerUnder(item, items, units) {
  const below = stackPlaces(items, units).get(item.branch)?.below;
  return below ? items.find(({ id }) => id === below) ?? null : null;
}
