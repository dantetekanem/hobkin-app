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
