import { readFileSync } from 'node:fs';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import {
  addMemory, changeMemory, forgetMemory, keepMemory, MEMORY_KINDS, MOST_DESCRIPTION, MOST_TEXT, recallMemories, restoreMemory, memorySecretKind, secretRefusal,
} from './memories.mjs';
import { rememberHeard, suggestMemory, suggestionOf } from './inbox.mjs';
import { MEMORY_USERS, recordMemoryUse } from './memory-use.mjs';

/**
 * The tools agents keep hobkin's memories with (057-shared-memory). `hobkin_recall` reads one whole, for every agent
 * with tools. `hobkin_remember` saves at once, for the agents the user talks to: the main chat and durable hobkins.
 * `hobkin_suggest_memory` hands one to the main chat to file, for the agents the user does not talk to: routines, Work
 * runs and session runs. Each runs in hobkin, which knows the agent by who asks (`memoryHandler`) and stamps the
 * memory with it, so nothing an agent types says who it is.
 */

export const RECALL_TOOL = 'hobkin_recall';
export const REMEMBER_TOOL = 'hobkin_remember';
export const SUGGEST_TOOL = 'hobkin_suggest_memory';
export const MEMORY_TOOLS = Object.freeze([RECALL_TOOL, REMEMBER_TOOL, SUGGEST_TOOL]);

const words = name => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8').trim();
const oneOf = values => Type.Union(values.map(value => Type.Literal(value)));
const NOT_HERE = 'Memories are not available here.';
const RUNS_SUGGEST = 'Only the agents the user talks to save memories. Suggest it with hobkin_suggest_memory, and the main hobkin files it.';
// Where a memory's `said` is the user's own words: what they told an agent they talk to, or typed in the window.
const USERS_OWN = ['chat', 'window'];
const KIND_WORDS = { user: 'about the user', preference: 'how they like things', date: 'a date', decision: 'a decision', project: 'a project', pointer: 'where something is' };

// Only the types: hobkin checks the bounds, so a memory past them is refused in hobkin's own words.
const recallParameters = Type.Object({
  name: Type.Optional(Type.String({ description: 'A memory\'s exact name, as the index lists it.' })),
  kind: Type.Optional(oneOf(MEMORY_KINDS)),
  words: Type.Optional(Type.String({ description: 'Words that must all be in the memory.' })),
  limit: Type.Optional(Type.Integer({ description: 'At most this many, 1 to 20. Default 5.' })),
}, { additionalProperties: false });

const memoryFields = {
  kind: Type.Optional(oneOf(MEMORY_KINDS)),
  description: Type.Optional(Type.String({ description: `One line of at most ${MOST_DESCRIPTION} characters: what every agent reads in its index.` })),
  text: Type.Optional(Type.String({ description: `The fact in plain sentences, at most ${MOST_TEXT} characters.` })),
  until: Type.Optional(Type.String({ description: 'YYYY-MM-DD: after this day it leaves every index. "" clears it.' })),
};
// Only an agent the user talks to quotes them, from their message in this turn: a run never has their words.
const userSaid = Type.Optional(Type.String({ description: 'The user\'s own words from their message in this turn, when it came from them.' }));

const rememberParameters = Type.Object({
  action: oneOf(['add', 'change', 'forget', 'restore', 'keep']),
  name: Type.String({ description: 'Lower-case words joined by hyphens, such as lives-in-lisbon.' }),
  ...memoryFields,
  said: userSaid,
  private: Type.Optional(Type.Boolean({ description: 'Keep it from every run hobkin starts: only the main chat and durable hobkins read it.' })),
  suggestion: Type.Optional(Type.String({ description: 'The id of the suggestion you are filing, from your note.' })),
}, { additionalProperties: false });

const suggestParameters = Type.Object({
  name: Type.Optional(Type.String({ description: 'A name you would give it, lower-case words joined by hyphens.' })),
  ...memoryFields,
}, { additionalProperties: false });

const answer = details => ({ content: [{ type: 'text', text: details.text }], details });
const day = at => (typeof at === 'string' ? at.slice(0, 10) : 'an unknown day');

function who(by) {
  if (by?.kind === 'user') return 'the user';
  if (by?.kind === 'main') return 'the main hobkin';
  if (by?.kind === 'hobkin') return `durable hobkin "${by.title ?? by.id ?? 'unnamed'}"`;
  if (by?.kind === 'outside') return `"${by.title ?? 'another session'}" (another of the user's sessions)`;
  if (by?.kind === 'suggested') return `a suggestion from "${by.title ?? 'a run'}"`;
  return 'someone hobkin did not record';
}

/** One memory whole, as an agent reads it. */
function memoryText(memory) {
  const marks = `${memory.private ? ', private' : ''}${memory.unconfirmed ? ', not yet kept' : ''}`;
  const heading = `${memory.name} (${KIND_WORDS[memory.kind]}${marks}): ${memory.description}`;
  const story = [
    memory.added ? `Added by ${who(memory.added.by)} on ${day(memory.added.at)}.` : 'Written by hand.',
    memory.changed ? `Changed by ${who(memory.changed.by)} on ${day(memory.changed.at)}.` : '',
    memory.source?.said && USERS_OWN.includes(memory.source.kind) ? `The user said: "${memory.source.said}".` : '',
    memory.links?.length ? `Links: ${memory.links.join(', ')}.` : '',
    memory.past ? `Past: its day was ${memory.until}.` : memory.until ? `Until ${memory.until}.` : '',
  ].filter(Boolean).join(' ');
  return [heading, memory.text, story].filter(Boolean).join('\n');
}

const doneText = {
  added: name => `Remembered "${name}". The user sees a line in Chat with Undo.`,
  changed: name => `Changed "${name}".`,
  forgot: name => `Forgot "${name}". It can be restored for 30 days.`,
  restored: name => `Restored "${name}".`,
};

/** What a run suggests, checked as a memory would be, so the main agent files nothing it would refuse. */
function suggested(params) {
  if (!MEMORY_KINDS.includes(params.kind)) throw Error(`A memory's kind is one of ${MEMORY_KINDS.join(', ')}.`);
  const description = typeof params.description === 'string' ? params.description.trim() : '';
  if (!description || /[\x00-\x1f\x7f-\x9f]/.test(description) || description.length > MOST_DESCRIPTION) {
    throw Error(`A memory's description is one line of 1 to ${MOST_DESCRIPTION} characters.`);
  }
  const text = typeof params.text === 'string' ? params.text.trim() : '';
  if (text.length > MOST_TEXT) throw Error(`A memory's text is at most ${MOST_TEXT} characters.`);
  const secret = memorySecretKind({ name: params.name, description, text });
  if (secret) throw Error(secretRefusal(secret, 'suggested'));
  const name = typeof params.name === 'string' && /^[a-z0-9][a-z0-9-]{1,59}$/.test(params.name) ? params.name : undefined;
  const until = typeof params.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.until) ? params.until : undefined;
  return {
    ...(name ? { name } : {}),
    kind: params.kind,
    description,
    ...(text ? { text } : {}),
    ...(until ? { until } : {}),
  };
}

/** Who a keeper saves as: a durable hobkin by its id and title, or the main hobkin. */
function authorOf(owner) {
  if (owner?.kind !== 'hobkin') return { kind: 'main' };
  return { kind: 'hobkin', id: owner.id, ...(owner.title ? { title: owner.title } : {}) };
}

/**
 * Who an add is by and where it came from: the run whose suggestion it files, when `suggestion` names one, or else the
 * keeper itself from its chat with the user.
 */
function addedBy(root, params, by) {
  const filed = suggestionOf(root, params.suggestion);
  if (!filed) return { by, source: { kind: 'chat', said: params.said } };
  return {
    by: { kind: 'suggested', ...(filed.runId ? { id: filed.runId } : {}), title: filed.from },
    source: { kind: 'suggested', from: filed.from },
  };
}

const CHANGEABLE = ['kind', 'description', 'text', 'until', 'private'];

/** One `hobkin_remember` call done in the store: `{ change, did, by, memory? }`, or its refusal thrown. */
function saved(root, params, { by, now }) {
  const { action, name } = params;
  if (action === 'add') {
    const asked = addedBy(root, params, by);
    const fields = {
      name,
      kind: params.kind,
      description: params.description,
      text: params.text,
      until: params.until,
      private: params.private === true,
    };
    return { ...addMemory(root, fields, { ...asked, now }), did: 'added', by: asked.by };
  }
  // Only the main chat keeps one another session handed over, and only once it heard of it with the user's message.
  const mayKeep = by.kind === 'main' && rememberHeard(root, name);
  if (action === 'change') {
    const given = CHANGEABLE.filter(key => params[key] !== undefined);
    const fields = Object.fromEntries(given.map(key => [key, params[key]]));
    const keeping = mayKeep && recallMemories(root, { name }, { private: true, now })[0]?.unconfirmed === true;
    return { ...changeMemory(root, name, fields, { by, now, keep: mayKeep }), did: 'changed', by, ...(keeping ? { kept: true } : {}) };
  }
  if (action === 'keep') {
    if (by.kind !== 'main') throw Error('Only the user or the main hobkin keeps a memory another session handed over.');
    if (!mayKeep) throw Error(`"${name}" can be kept once the main hobkin hears of it with the user's next message, or by the user on the Memory page.`);
    return { ...keepMemory(root, name, { by, now }), did: 'changed', by, kept: true, words: `Kept "${name}". Every agent hobkin runs reads it from now on.` };
  }
  if (action === 'forget') return { ...forgetMemory(root, name, { by, now }), did: 'forgot', by };
  if (action === 'restore') return { ...restoreMemory(root, name, { by, now }), did: 'restored', by };
  throw Error('Say what to do: add, change, forget, restore or keep.');
}

/**
 * Which memories a recall gave whole, as the reader that asked (`memory-use.mjs`). A count not written costs the count,
 * never the recall.
 */
function noteRecalled(root, memories, owner, now) {
  if (!memories.length || !MEMORY_USERS.includes(owner?.kind)) return;
  try {
    recordMemoryUse(root, { kind: 'recall', names: memories.map(memory => memory.name), by: owner.kind }, { now });
  } catch {
    // The recall stands.
  }
}

/**
 * What an agent's memory tools reach, by who it is: `{ kind: 'main' }`, `{ kind: 'hobkin', id, title }` for a durable
 * hobkin, or `{ kind: 'run', id, title }` for a routine, a Work run or a session run. The first two read private
 * memories and remember at once; a run reads shared ones and suggests. Each recall counts what it gave as that reader's
 * use. `onChange` hears each change one makes, as `{ change, name, did, description, by }`, so hobkin can post it in
 * Chat.
 */
export function memoryHandler(root, owner, { now = Date.now, onChange = () => {} } = {}) {
  const keeps = owner?.kind === 'main' || owner?.kind === 'hobkin';
  const handler = {
    recall: params => {
      if (!params?.name && !params?.kind && !params?.words) throw Error('Say what to recall: a name, a kind or words.');
      const at = now();
      const memories = recallMemories(root, params, { private: keeps, now: at });
      noteRecalled(root, memories, owner, at);
      const text = memories.length ? memories.map(memoryText).join('\n\n') : 'No memory matches. The index in your prompt lists every memory by name.';
      return { text, memories };
    },
  };

  if (owner?.kind === 'run') {
    handler.suggest = params => {
      const memory = suggested(params ?? {});
      const result = suggestMemory(root, { memory, from: owner.title ?? owner.id, runId: owner.id }, now());
      return { text: result.message, id: result.id };
    };
  }
  if (!keeps) return handler;

  const by = authorOf(owner);
  handler.remember = params => {
    const { name } = params ?? {};
    const done = saved(root, params ?? {}, { by, now: now() });
    try {
      onChange({ change: done.change, name, did: done.did, description: done.memory?.description, by: done.by, ...(done.kept ? { kept: true } : {}) });
    } catch {
      // A line in Chat that could not be posted costs the line, never the memory.
    }
    return {
      text: done.words ?? doneText[done.did](name),
      change: done.change,
      did: done.did,
      ...(done.memory ? { memory: done.memory } : {}),
    };
  };
  return handler;
}

function tool(name, label, prompt, parameters, run, missing = NOT_HERE) {
  return defineTool({
    name,
    label,
    description: words(prompt),
    parameters,
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      if (!run) throw Error(missing);
      return answer(await run(params, signal));
    },
  });
}

export const createRecallTool = recall => tool(RECALL_TOOL, 'Recall a memory', 'recall-tool', recallParameters, recall);
/** Without `remember`, from an agent that may only suggest, a call says so. */
export const createRememberTool = (remember, { suggests = false } = {}) => tool(REMEMBER_TOOL, 'Remember', 'remember-tool', rememberParameters, remember, suggests ? RUNS_SUGGEST : NOT_HERE);
export const createSuggestMemoryTool = suggest => tool(SUGGEST_TOOL, 'Suggest a memory', 'suggest-memory-tool', suggestParameters, suggest);

/** The main chat's two, which it reads and saves with: it suggests to no one. */
export const MAIN_MEMORY_TOOLS = Object.freeze([RECALL_TOOL, REMEMBER_TOOL]);
export const mainMemoryTools = handler => ({
  [RECALL_TOOL]: createRecallTool(handler?.recall),
  [REMEMBER_TOOL]: createRememberTool(handler?.remember),
});

/** The three tools on one handler, by name, as a bridge serves them. */
export const memoryTools = handler => ({
  [RECALL_TOOL]: createRecallTool(handler?.recall),
  [REMEMBER_TOOL]: createRememberTool(handler?.remember, { suggests: Boolean(handler?.suggest) }),
  [SUGGEST_TOOL]: createSuggestMemoryTool(handler?.suggest),
});
