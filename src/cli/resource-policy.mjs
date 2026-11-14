import { isAbsolute } from 'node:path';

export const RESOURCE_KINDS = Object.freeze(['instructions', 'skills', 'extensions', 'templates', 'mcp', 'tools']);
export const RESOURCE_PURPOSES = Object.freeze(['main', 'background', 'compatibility-check', 'work-discover', 'work-look', 'work-do', 'migration-repair', 'reflection', 'session-patterns', 'humanizer']);
const toolPurposes = new Set(['main', 'background', 'compatibility-check', 'work-discover', 'work-look', 'work-do']);
const builtinTools = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];
const validId = id => typeof id === 'string' && /^[a-z][a-z0-9._:-]{0,159}$/.test(id) && !id.includes('..');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function fields(value, allowed) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) throw Error('Invalid resource selection fields.');
}

/** Persisted intent only: no discovery, installation, activation or invocation evidence. */
export function validateResourceSelection(value = { version: 1, purposes: {} }) {
  fields(value, ['version', 'purposes']);
  if (value.version !== 1) throw Error('Unsupported resource selection version.');
  const purposes = value.purposes === undefined ? {} : value.purposes;
  fields(purposes, RESOURCE_PURPOSES);
  const normalized = {};
  for (const purpose of RESOURCE_PURPOSES) {
    const selection = purposes[purpose] === undefined ? {} : purposes[purpose];
    fields(selection, RESOURCE_KINDS);
    normalized[purpose] = {};
    for (const kind of RESOURCE_KINDS) {
      const ids = selection[kind] === undefined ? [] : selection[kind];
      if (!Array.isArray(ids) || ids.length > 64 || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) {
        throw Error('Invalid resource selection IDs.');
      }
      normalized[purpose][kind] = [...ids];
    }
  }
  return { version: 1, purposes: normalized };
}

/** Candidates are explicit already-installed facts supplied by a separate inventory owner. */
export function resolveResourcePolicy(value, purpose, candidates) {
  if (!RESOURCE_PURPOSES.includes(purpose)) throw Error('Unsupported resource purpose.');
  if (!Array.isArray(candidates) || candidates.length > 4096) throw Error('Explicit installed resource candidates required.');
  const installed = new Map();
  for (const candidate of candidates) {
    if (!record(candidate) || !validId(candidate.id) || !RESOURCE_KINDS.includes(candidate.kind)
      || candidate.installed !== true || installed.has(candidate.id)) throw Error('Invalid installed resource candidate.');
    installed.set(candidate.id, candidate.kind);
  }
  const selection = validateResourceSelection(value);
  for (const byKind of Object.values(selection.purposes)) {
    for (const kind of RESOURCE_KINDS) {
      if (byKind[kind].some(id => installed.get(id) !== kind)) throw Error('Selected resource is stale or not installed for its kind.');
    }
  }
  const toolsEnabled = toolPurposes.has(purpose);
  return {
    version: 1, purpose, selected: selection.purposes[purpose],
    // Requirements, not a claim that these resources have actually loaded.
    hobkinProvided: ['bundled-prompts', ...(purpose === 'main' ? ['directions', 'memory'] : []), ...(toolsEnabled ? ['bridge-tools'] : [])],
    builtinTools: toolsEnabled ? [...builtinTools] : [],
  };
}

/*
 * Version 2 (the client's `_specs/038-resources`): for each kind of agent, the catalog ids chosen for it. Nothing running
 * reads it yet; the main chat and the runs still take version 1 above until they are moved over.
 */
export const SELECTION_KINDS = Object.freeze(['main', 'background', 'work', 'durable']);
export const RESOURCE_TYPES = Object.freeze(['package', 'extension', 'skill', 'builtin', 'context']);
export const MOST_CHOSEN = 128;
const MOST_ID_CHARS = 300;
const unprintable = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;
// Pi's own, in every run that uses tools. They are not resources, so nothing chooses them.
const ALWAYS_LOADED = ['builtin:codemode', 'builtin:tool-search'];

/** A catalog id is its type, a colon and printable text. A bare path has no type, so it is never taken for an id. */
export function isResourceId(id) {
  if (typeof id !== 'string' || id.length > MOST_ID_CHARS || unprintable.test(id)) return false;
  const colon = id.indexOf(':');
  const rest = id.slice(colon + 1);
  return colon > 0 && RESOURCE_TYPES.includes(id.slice(0, colon)) && rest !== '' && rest.trim() === rest;
}

function chosenIds(ids) {
  if (!Array.isArray(ids) || ids.length > MOST_CHOSEN || ids.some(id => !isResourceId(id)) || new Set(ids).size !== ids.length) {
    throw Error('Invalid resource ids: each is a catalog id, never a path, at most 128 for a kind.');
  }
  return [...ids];
}

/** Version 1 was only ever written by tests, and reads as nothing chosen. */
export function normalizeSelection(value) {
  if (value === undefined || (record(value) && value.version === 1)) return { version: 2, kinds: Object.fromEntries(SELECTION_KINDS.map(kind => [kind, []])) };
  fields(value, ['version', 'kinds']);
  if (value.version !== 2) throw Error('Unsupported resource selection version.');
  const kinds = value.kinds === undefined ? {} : value.kinds;
  fields(kinds, SELECTION_KINDS);
  return { version: 2, kinds: Object.fromEntries(SELECTION_KINDS.map(kind => [kind, chosenIds(kinds[kind] === undefined ? [] : kinds[kind])])) };
}

function catalogItems(catalog) {
  if (!Array.isArray(catalog?.items)) throw Error('A resource catalog is required.');
  return new Map(catalog.items.map(item => [item.id, item]));
}

function kindOf(kind) {
  if (!SELECTION_KINDS.includes(kind)) throw Error('Unsupported resource kind.');
  return kind;
}

/** Turning an id on checks it against the catalog and the kinds it is offered to. Turning one off always works, also for one that is gone. */
export function changeSelection(selection, { kind, on = [], off = [] } = {}, catalog) {
  const current = normalizeSelection(selection);
  kindOf(kind);
  chosenIds(on);
  chosenIds(off);
  if (on.some(id => off.includes(id))) throw Error('A resource id cannot be turned on and off at once.');
  const items = catalogItems(catalog);
  for (const id of on) {
    const item = items.get(id);
    if (!item) throw Error(`${id} is not in the resource catalog.`);
    if (item.offered?.[kind] !== true) throw Error(`${id} is not offered to ${kind}.`);
  }
  const kept = current.kinds[kind].filter(id => !off.includes(id));
  return normalizeSelection({ version: 2, kinds: { ...current.kinds, [kind]: [...kept, ...on.filter(id => !kept.includes(id))] } });
}

const loadablePath = path => typeof path === 'string' && (isAbsolute(path) || /^builtin:[a-z0-9.-]+$/.test(path));

/**
 * What a kind's choices load, from a catalog built for this run. A chosen id the catalog no longer has is missing: the run
 * starts without it and says so. The paths come only from the catalog, never from the selection.
 */
export function chosenResources(selection, kind, catalog) {
  const ids = normalizeSelection(selection).kinds[kindOf(kind)];
  const items = catalogItems(catalog);
  const chosen = [], missing = [];
  for (const id of ids) {
    const item = items.get(id);
    if (!item) { missing.push({ id, reason: 'not-installed' }); continue; }
    if (item.offered?.[kind] !== true) { missing.push({ id, reason: 'not-offered' }); continue; }
    const paths = Object.fromEntries(['extensions', 'skills', 'context'].map(key => [key, [...(item.paths?.[key] ?? [])]]));
    if (Object.values(paths).flat().some(path => !loadablePath(path))) throw Error('Catalog resource paths must be absolute or built in.');
    chosen.push({ id, type: item.type, ...paths });
  }
  return { kind, chosen, missing };
}

/**
 * Pi's flags for one run: nothing of Pi's but its own tools, code mode and tool search, then each chosen path. These are Pi's
 * own flags (`docs/cli.md`). A launcher that manages its own extensions refuses `--no-extensions`, so under one the
 * extensions are the launcher's and only skills and context files follow the choice.
 */
export function resourceFlags({ chosen }, { managedExtensions = false } = {}) {
  const paths = key => [...new Set(chosen.flatMap(item => item[key]))];
  return [
    ...(managedExtensions ? [] : ['--no-extensions']),
    '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve',
    ...(managedExtensions ? [] : [...ALWAYS_LOADED.flatMap(path => ['-e', path]), ...paths('extensions').flatMap(path => ['--extension', path])]),
    ...paths('skills').flatMap(path => ['--skill', path]),
    ...paths('context').flatMap(path => ['--append-system-prompt', path]),
  ];
}
