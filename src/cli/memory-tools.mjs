import { readFileSync } from 'node:fs';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import {
  addMemory, changeMemory, forgetMemory, looksSecret, MEMORY_KINDS, MOST_DESCRIPTION, MOST_TEXT, recallMemories, restoreMemory,
} from './memories.mjs';
import { suggestMemory, suggestionOf } from './inbox.mjs';

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
  said: Type.Optional(Type.String({ description: 'The user\'s own words, when it came from them.' })),
};

const rememberParameters = Type.Object({
  action: oneOf(['add', 'change', 'forget', 'restore']),
  name: Type.String({ description: 'Lower-case words joined by hyphens, such as lives-in-lisbon.' }),
  ...memoryFields,
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
  const heading = `${memory.name} (${KIND_WORDS[memory.kind]}${memory.private ? ', private' : ''}): ${memory.description}`;
  const story = [
    memory.added ? `Added by ${who(memory.added.by)} on ${day(memory.added.at)}.` : 'Written by hand.',
    memory.changed ? `Changed by ${who(memory.changed.by)} on ${day(memory.changed.at)}.` : '',
    memory.source?.said ? `The user said: "${memory.source.said}".` : '',
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
  if ([params.name, description, text, params.said].some(looksSecret)) {
    throw Error('Nothing was suggested: it looks like a secret (a password, a key, a token, a card or an account number), and hobkin keeps none.');
  }
  const name = typeof params.name === 'string' && /^[a-z0-9][a-z0-9-]{1,59}$/.test(params.name) ? params.name : undefined;
  const until = typeof params.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.until) ? params.until : undefined;
  const said = typeof params.said === 'string' && params.said.trim() ? params.said.trim().slice(0, 300) : undefined;
  return { ...(name ? { name } : {}), kind: params.kind, description, ...(text ? { text } : {}), ...(until ? { until } : {}), ...(said ? { said } : {}) };
}

/**
 * What an agent's memory tools reach, by who it is: `{ kind: 'main' }`, `{ kind: 'hobkin', id, title }` for a durable
 * hobkin, or `{ kind: 'run', id, title }` for a routine, a Work run or a session run. The first two read private
 * memories and remember at once; a run reads shared ones and suggests. `onChange` hears each change one makes, as
 * `{ change, name, did, description, by }`, so hobkin can post it in Chat.
 */
export function memoryHandler(root, owner, { now = Date.now, onChange = () => {} } = {}) {
  const keeps = owner?.kind === 'main' || owner?.kind === 'hobkin';
  const by = owner?.kind === 'hobkin' ? { kind: 'hobkin', id: owner.id, ...(owner.title ? { title: owner.title } : {}) } : { kind: 'main' };
  const handler = {
    recall: params => {
      if (!params?.name && !params?.kind && !params?.words) throw Error('Say what to recall: a name, a kind or words.');
      const memories = recallMemories(root, params, { private: keeps, now: now() });
      const text = memories.length ? memories.map(memoryText).join('\n\n') : 'No memory matches. The index in your prompt lists every memory by name.';
      return { text, memories };
    },
  };
  if (owner?.kind === 'run') {
    handler.suggest = params => {
      const result = suggestMemory(root, { memory: suggested(params ?? {}), from: owner.title ?? owner.id, runId: owner.id }, now());
      return { text: result.message, id: result.id };
    };
  }
  if (!keeps) return handler;
  handler.remember = params => {
    const at = now();
    const { action, name } = params ?? {};
    let done;
    if (action === 'add') {
      const filed = suggestionOf(root, params.suggestion);
      const asked = filed ? { kind: 'suggested', ...(filed.runId ? { id: filed.runId } : {}), title: filed.from } : by;
      const source = filed ? { kind: 'suggested', said: params.said ?? filed.memory?.said, from: filed.from } : { kind: 'chat', said: params.said };
      const fields = { name, kind: params.kind, description: params.description, text: params.text, until: params.until, private: params.private === true };
      done = { ...addMemory(root, fields, { by: asked, source, now: at }), did: 'added', by: asked };
    } else if (action === 'change') {
      const fields = Object.fromEntries(['kind', 'description', 'text', 'until', 'private'].filter(key => params[key] !== undefined).map(key => [key, params[key]]));
      done = { ...changeMemory(root, name, fields, { by, now: at }), did: 'changed', by };
    } else if (action === 'forget') {
      done = { ...forgetMemory(root, name, { by, now: at }), did: 'forgot', by };
    } else if (action === 'restore') {
      done = { ...restoreMemory(root, name, { by, now: at }), did: 'restored', by };
    } else throw Error('Say what to do: add, change, forget or restore.');
    try {
      onChange({ change: done.change, name, did: done.did, description: done.memory?.description, by: done.by });
    } catch {
      // A line in Chat that could not be posted costs the line, never the memory.
    }
    return { text: doneText[done.did](name), change: done.change, did: done.did, ...(done.memory ? { memory: done.memory } : {}) };
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

/** The three tools on one handler, by name, as a bridge serves them. */
export const memoryTools = handler => ({
  [RECALL_TOOL]: createRecallTool(handler?.recall),
  [REMEMBER_TOOL]: createRememberTool(handler?.remember, { suggests: Boolean(handler?.suggest) }),
  [SUGGEST_TOOL]: createSuggestMemoryTool(handler?.suggest),
});
