/*
 * What a Pi run loaded, seen from inside Pi (the client's `_specs/038-resources`). hobkin adds this extension to a run it
 * starts; at each turn's `before_agent_start` it sends one status record under its own key, the way hobkin's bridge
 * reports its tools. It sends paths and names only, never a file's text, and it never changes the prompt. Nothing loads it
 * yet.
 */
export const RESOURCE_FACTS = 'hobkin/resources';
const MOST_TOOLS = 1024;
const MOST_SKILLS = 512;
const MOST_FILES = 64;
const MOST_CHARS = 1024;
// hobkin's RPC reader leaves out a record over 1 MB, and what it leaves out adds up toward stopping the run.
const MOST_RECORD_BYTES = 262144;

const clip = value => (typeof value === 'string' ? value.slice(0, MOST_CHARS) : '');
const list = value => (Array.isArray(value) ? value : []);

/**
 * The record for one turn: each tool with the file it came from (`getAllTools()` and its `sourceInfo`), the skills, and
 * the context files Pi found by itself. Past its byte budget it keeps what fits and says it is cut short.
 */
export function factsRecord(tools, options = {}) {
  const record = { version: 1, tools: [], skills: [], contextFiles: [] };
  let bytes = 128, truncated = false;
  const keep = (key, entries, most, shape) => {
    for (const entry of list(entries).slice(0, most)) {
      const kept = shape(entry);
      bytes += Buffer.byteLength(JSON.stringify(kept)) + 1;
      if (bytes > MOST_RECORD_BYTES) { truncated = true; return; }
      record[key].push(kept);
    }
    if (list(entries).length > most) truncated = true;
  };
  keep('contextFiles', options?.contextFiles, MOST_FILES, file => ({ path: clip(file?.path) }));
  keep('skills', options?.skills, MOST_SKILLS, skill => ({ name: clip(skill?.name), path: clip(skill?.filePath), source: clip(skill?.sourceInfo?.source) }));
  keep('tools', tools, MOST_TOOLS, tool => ({ name: clip(tool?.name), path: clip(tool?.sourceInfo?.path), source: clip(tool?.sourceInfo?.source) }));
  return truncated ? { ...record, truncated } : record;
}

const sendStatus = (ctx, record) => ctx.ui.setStatus(RESOURCE_FACTS, JSON.stringify(record));

/** The extension, sending each record through `report`: a status record by default, which reaches hobkin over Pi's RPC. */
export function createResourceFacts(report = sendStatus) {
  return function resourceFacts(pi) {
    pi.on('before_agent_start', (event, ctx) => {
      try {
        report(ctx, factsRecord(pi.getAllTools(), event?.systemPromptOptions));
      } catch {
        // The facts are a side record. A turn never waits on them or fails for them.
      }
    });
  };
}

export default createResourceFacts();

const named = (entry, keys) => entry !== null && typeof entry === 'object' && keys.every(key => typeof entry[key] === 'string');

/** A record as hobkin reads it back, or undefined for anything that is not one. */
export function readFacts(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (value?.version !== 1 || !Array.isArray(value.tools) || !Array.isArray(value.skills) || !Array.isArray(value.contextFiles)
    || value.tools.length > MOST_TOOLS || value.skills.length > MOST_SKILLS || value.contextFiles.length > MOST_FILES
    || !value.tools.every(tool => named(tool, ['name', 'path'])) || !value.skills.every(skill => named(skill, ['name', 'path']))
    || !value.contextFiles.every(file => named(file, ['path']))) return undefined;
  return value;
}

/** The record in one of Pi's RPC output records, when that record is this extension's status. */
export const factsFromUiRequest = record => (record?.type === 'extension_ui_request' && record.method === 'setStatus' && record.statusKey === RESOURCE_FACTS
  ? readFacts(record.statusText) : undefined);
