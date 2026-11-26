import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { decidedSection, readDecided } from './decided.mjs';
import { directionsSection, readDirections } from './directions.mjs';
import { writePrivate } from './reports.mjs';
import { readPersona } from './config.mjs';
import { composePersonaPrompt } from './persona.mjs';
import { MAIN_INDEX_BYTES, memoryIndex } from './memories.mjs';

const MAX_ITEMS = 20;
const MAX_ITEM_LENGTH = 200;
const MAX_FILE_BYTES = 65536;

const line = maxLength => Type.String({ minLength: 1, maxLength, pattern: '^[^\\x00-\\x1f\\x7f-\\x9f]+$' });
const parameters = Type.Object({
  action: Type.Union([Type.Literal('add'), Type.Literal('replace'), Type.Literal('remove')]),
  item: Type.Optional(line(MAX_FILE_BYTES)),
  text: Type.Optional(line(MAX_ITEM_LENGTH)),
}, { additionalProperties: false });

const memoryPath = root => join(root, 'memory.md');
const bulletList = items => items.map(item => `- ${item}`).join('\n');

function storedItems(root) {
  const file = memoryPath(root);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return [];
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw Error('Memory must be a regular bounded file.');
  return readFileSync(file, 'utf8')
    .split('\n')
    .map(entry => entry.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean);
}

/** The bounded list agents see. A hand-edited file may hold more. */
export const readMemory = root => storedItems(root)
  .slice(0, MAX_ITEMS)
  .map(item => item.slice(0, MAX_ITEM_LENGTH));

/** Bytes of agent memory on disk: the shared list plus each check's own file. */
export function memoryBytes(root) {
  const size = file => {
    const stat = lstatSync(file, { throwIfNoEntry: false });
    return stat?.isFile() ? stat.size : 0;
  };
  const checks = join(root, 'checks');
  const ids = lstatSync(checks, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(checks) : [];
  const checkFiles = ids.map(id => join(checks, id, 'memory.md'));
  return [memoryPath(root), ...checkFiles].reduce((total, file) => total + size(file), 0);
}

function applyChange(items, { action, item, text }) {
  if (action === 'add' && items.length >= MAX_ITEMS) {
    throw Error(`Memory is full at ${MAX_ITEMS} items. Replace or remove one first.`);
  }
  if (action === 'add') return [...items, text.trim()];
  if (!items.includes(item)) throw Error('Memory has no item with that exact text.');
  if (action === 'remove') return items.filter(entry => entry !== item);
  return items.map(entry => (entry === item ? text.trim() : entry));
}

/** Every item the list holds as written, for the window, which changes one by its exact text. */
export const readMemoryItems = root => storedItems(root);

/** A fingerprint of the list's file as it is now, empty or missing alike, so a change made meanwhile is not lost. */
export const memoryListVersion = root => {
  const stat = lstatSync(memoryPath(root), { throwIfNoEntry: false });
  return createHash('sha256').update(stat?.isFile() ? readFileSync(memoryPath(root)) : '').digest('hex');
};

/** One change to the list by the tool's rules, written at once. It answers the items the list holds after it. */
export function changeMemoryList(root, request) {
  const needsText = request?.action !== 'remove';
  if (!Check(parameters, request) || (needsText && !request.text?.trim())
    || (request.action !== 'add' && !request.item)) {
    throw Error(`Invalid memory change: use one line of at most ${MAX_ITEM_LENGTH} characters; replace and remove need the exact item.`);
  }
  const items = applyChange(storedItems(root), request);
  writePrivate(memoryPath(root), items.length ? `${bulletList(items)}\n` : '');
  return items;
}

export function createMemoryTool(root) {
  return defineTool({
    name: 'hobkin_memory',
    label: 'Hobkin memory',
    description: `Change the user's short list of things that matter, kept across Hobkin conversations. `
      + `Add an item, or replace or remove one by its exact text. Holds at most ${MAX_ITEMS} one-line items.`,
    parameters,
    async execute(_id, request) {
      const items = changeMemoryList(root, request);
      const summary = `Memory holds ${items.length} of ${MAX_ITEMS} items.\n${bulletList(items)}`.trim();
      return { content: [{ type: 'text', text: summary }], details: { items } };
    },
  });
}

export const memorySection = items => `## Current memory\n\n${items.length ? bulletList(items) : 'Memory is empty.'}`;

/** Capture current context and style once per run; changes apply at the next before_agent_start. */
export const createMemoryExtension = root => pi => {
  pi.on('before_agent_start', event => {
    const persona = readPersona(root);
    const sections = [
      directionsSection(readDirections(root)),
      memorySection(readMemory(root)),
      // hobkin's memories, private ones too, when there are any (057-shared-memory).
      memoryIndex(root, { private: true, maxBytes: MAIN_INDEX_BYTES, recall: 'hobkin_recall' }),
      decidedSection(readDecided(root)),
    ].filter(Boolean);
    return { systemPrompt: composePersonaPrompt([event.systemPrompt, ...sections].join('\n\n'), persona) };
  });
};
