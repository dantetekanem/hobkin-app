import { readFileSync } from 'node:fs';

export const PERSONAS = Object.freeze(['Normal', 'Funnier', 'Serious', 'hal', 'her', 'jarvis', 'marvin', 'rocky', 'yoda']);

const readPrompt = name => readFileSync(new URL(`../prompts/persona/${name}.md`, import.meta.url), 'utf8');
const boundary = readPrompt('style-boundary');
const voices = new Map(PERSONAS.slice(1).map(persona => [persona, readPrompt(persona.toLowerCase())]));

export function validatePersona(persona = 'Normal') {
  if (!PERSONAS.includes(persona)) throw new TypeError('Invalid persona');
  return persona;
}

/** Always compose from the uncustomized base, including its current directions and memory. */
export function composePersonaPrompt(basePrompt, persona = 'Normal') {
  validatePersona(persona);
  if (typeof basePrompt !== 'string') throw new TypeError('Expected a text base prompt');
  if (persona === 'Normal') return basePrompt;
  return `${basePrompt}\n\n<hobkin-persona>\n${boundary}\n<voice-style>\n${voices.get(persona)}\n</voice-style>\n</hobkin-persona>`;
}

/** Retain the base separately so applying another selection replaces, rather than stacks, voices. */
export function applyPersona({ basePrompt }, persona = 'Normal') {
  return Object.freeze({ basePrompt, persona, systemPrompt: composePersonaPrompt(basePrompt, persona) });
}
