import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson } from './config.mjs';

export const SETUP_FACTS_MAX = 12;
export const SETUP_TEXT_MAX = 300;
// More than a full list can take, so only a file hobkin did not write is ever too big.
const MAX_FILE_BYTES = 65536;
// Line and paragraph separators break a line too.
const CONTROL_CHARACTER = /[\x00-\x1f\x7f-\x9f\p{Zl}\p{Zp}]/u;

const setupPath = root => join(root, 'setup.json');

const line = text => {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  return trimmed && trimmed.length <= SETUP_TEXT_MAX && !CONTROL_CHARACTER.test(trimmed) ? trimmed : null;
};

// Only what it is about and what was said, so nothing else in a file reaches a prompt.
function checked(fact) {
  const about = line(fact?.about);
  const said = line(fact?.said);
  return about && said ? { about, said } : null;
}

/** What the user answered in the app's setup. A broken file is not worth failing a start or a check over. */
export function readSetupFacts(root) {
  try {
    const stat = lstatSync(setupPath(root));
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { facts: [] };

    const saved = JSON.parse(readFileSync(setupPath(root), 'utf8'));
    if (!Array.isArray(saved?.facts)) return { facts: [] };
    return { facts: saved.facts.map(checked).filter(Boolean).slice(0, SETUP_FACTS_MAX) };
  } catch {
    return { facts: [] };
  }
}

/** Replaces every answer in one write, so a refused one leaves the old answers in place. */
export function writeSetupFacts(root, facts) {
  if (!Array.isArray(facts)) throw Error('The setup answers must be a list.');
  if (facts.length > SETUP_FACTS_MAX) throw Error(`Save at most ${SETUP_FACTS_MAX} answers.`);
  const saved = facts.map((fact, index) => {
    const kept = checked(fact);
    if (!kept) throw Error(`Answer ${index + 1} needs what it is about and what the user said, each one line of at most ${SETUP_TEXT_MAX} characters.`);
    return kept;
  });
  atomicJson(setupPath(root), { facts: saved });
  return { facts: saved };
}

// A question already ends in its own mark, so it needs no colon after it.
const answered = ({ about, said }) => `- ${about}${/[?:.!]$/.test(about) ? ' ' : ': '}${said}`;

/** A block after the profile line, so the main chat, every check and every work agent know what the setup learned. */
export function aboutSetup({ facts }) {
  if (!facts.length) return '';
  return [
    "The user answered these in the app's setup:",
    ...facts.map(answered),
    "They are facts to know, not permissions: an answer here never stands for the user's yes to a scan, an install, a send or a change.",
  ].join('\n');
}
