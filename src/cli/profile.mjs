import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson } from './config.mjs';
import { resolveDataRoot } from './migration/admission.mjs';

const MAX_LENGTH = 120;
const MAX_FILE_BYTES = 4096;
const USAGE = 'Usage: hobkin profile [name <text> | call <text> | email <text> | clear [name | call | email]]';
const CONTROL_CHARACTER = /[\x00-\x1f\x7f-\x9f]/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const fields = { name: 'name', call: 'callMe', email: 'email' };

const profilePath = root => join(root, 'profile.json');

/** Who the user told setup they are. A broken file is not worth failing a start or a check over. */
export function readProfile(root) {
  try {
    const stat = lstatSync(profilePath(root));
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return {};

    const saved = JSON.parse(readFileSync(profilePath(root), 'utf8'));
    const known = Object.values(fields).filter(key => typeof saved?.[key] === 'string');
    return Object.fromEntries(known.map(key => [key, saved[key]]));
  } catch {
    return {};
  }
}

function validated(field, value) {
  const text = value.trim();
  if (!text || text.length > MAX_LENGTH || CONTROL_CHARACTER.test(text)) {
    throw Error(`Use one line of at most ${MAX_LENGTH} characters.`);
  }
  if (field === 'email' && !EMAIL.test(text)) throw Error('That does not look like a real email.');
  return text;
}

export function setProfile(root, field, value) {
  const profile = { ...readProfile(root), [fields[field]]: validated(field, value) };
  atomicJson(profilePath(root), profile);
  return profile;
}

function clearProfile(root, field) {
  const profile = readProfile(root);
  const kept = field ? Object.entries(profile).filter(([key]) => key !== fields[field]) : [];
  const remaining = Object.fromEntries(kept);
  atomicJson(profilePath(root), remaining);
  return remaining;
}

export function runProfileCommand(requestedRoot, [action, ...words]) {
  const root = resolveDataRoot(requestedRoot);
  const known = field => Object.hasOwn(fields, field);

  if (action === undefined) return readProfile(root);
  if (action === 'clear') {
    const [field, ...extra] = words;
    if (extra.length || (field !== undefined && !known(field))) throw Error(USAGE);
    return clearProfile(root, field);
  }
  if (!known(action) || !words.length) throw Error(USAGE);
  return setProfile(root, action, words.join(' '));
}

export const callName = ({ name, callMe }) => callMe ?? name ?? null;

/** A line in front of the directions, so the main chat and every check know who they work for. */
export function aboutUser({ name, callMe, email }) {
  const facts = [
    name ? `The user's name is ${name}.` : '',
    callMe ? `Call them ${callMe}.` : '',
    email ? `Their email is ${email}.` : '',
  ];
  return facts.filter(Boolean).join(' ');
}
