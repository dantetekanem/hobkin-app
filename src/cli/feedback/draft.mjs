import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { sha256Hex } from '../remote/sign.mjs';
import { HOBKIN_VERSION } from '../version.mjs';

const FEEDBACK_KINDS = ['bug', 'crash', 'template', 'idea'];
export const MAX_MESSAGE_CHARACTERS = 8000;
const MAX_FEEDBACK_BYTES = 65536;
const CLIENT_VALUE = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The server refuses these characters, so they become spaces the preview shows.
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Tokens with a known prefix: OpenAI and Anthropic, GitHub, GitLab, Slack, Google, AWS and npm.
const KNOWN_KEYS = new RegExp(`\\b(?:${[
  'sk-[A-Za-z0-9_-]{12,}',
  'gh[pousr]_[A-Za-z0-9]{20,}',
  'github_pat_[A-Za-z0-9_]{20,}',
  'glpat-[A-Za-z0-9_-]{20,}',
  'xox[abeoprs]-[A-Za-z0-9-]{10,}',
  'AIza[0-9A-Za-z_-]{35}',
  'AKIA[A-Z0-9]{16}',
  'npm_[A-Za-z0-9]{36}',
].join('|')})`, 'g');

// In this order, and each replaced by words that none of these, nor the server's own checks, would catch again.
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key removed]'],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*@/gi, '$1'],
  [/([?&](?:access_token|token|key|api_key|apikey|secret|password|passwd|signature|sig|auth|code)=)[^&#\s]+/gi, '$1[removed]'],
  [/\b(?:password|passwd|secret|token|api[_ -]?key|authorization)\s*[:=]\s*(?:(?:bearer|basic)\s+)?\S+/gi, '[secret removed]'],
  [/\b(?:bearer|basic)\s+[A-Za-z0-9+/_=.-]{8,}/gi, '[token removed]'],
  [KNOWN_KEYS, '[key removed]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[token removed]'],
  [/\b[0-9a-f]{32,}\b/gi, '[key removed]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]'],
];
// Someone else's home folder names them too.
const ANY_HOME = /(?:\/Users|\/home)\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+/g;
const KIND_FIRST = /^(bug|crash|template|idea)(?::\s*|\s+|$)([\s\S]*)$/;
const KIND_WITH_COLON = /^(bug|crash|template|idea):\s*([\s\S]*)$/i;

/**
 * Takes out what would give the user away before anything is shown: emails, tokens and keys by their patterns, the
 * credentials in a URL, and absolute paths under a home folder, which name the person. It is best effort, so the
 * preview says so and the user reads the exact bytes before they go.
 */
export function redact(text, { home = homedir() } = {}) {
  let result = String(text);
  for (const [pattern, replacement] of SECRET_PATTERNS) result = result.replace(pattern, replacement);

  if (home && home !== '/') result = result.replace(new RegExp(`${escaped(home)}(?=/|\\b|$)`, 'g'), '~');
  return result.replace(ANY_HOME, '~');
}

const clientValue = value => (CLIENT_VALUE.test(String(value)) ? String(value) : 'unknown');

/** The running hobkin and machine, in the form the server takes. Nothing else about the machine goes. */
export const clientFacts = () => ({
  hobkin_version: clientValue(HOBKIN_VERSION),
  platform: clientValue(process.platform),
  arch: clientValue(process.arch),
  node_version: clientValue(process.versions.node),
  harness: 'pi',
});

/** A template is named only by provenance that was recorded when its routine was made. A matching file name is not provenance. */
function templateField(provenance) {
  const { id, version, userOverride } = provenance ?? {};
  const recorded = UUID.test(id ?? '') && Number.isInteger(version) && version >= 1;
  return recorded ? { id, version, user_override: userOverride === true } : { user_override: true };
}

const toSecond = now => `${new Date(Math.floor(now / 1000) * 1000).toISOString().slice(0, 19)}Z`;
const cleaned = message => String(message ?? '').toWellFormed().replace(CONTROL, ' ');

/**
 * One report as the exact bytes the user approves: the contract's fields in its order, pretty-printed so the preview
 * is readable, and hashed over those bytes. Nothing is ever added after this, so what is shown is what goes.
 */
export function draftFeedback({
  kind,
  message,
  id = randomUUID(),
  now = Date.now(),
  client = clientFacts(),
  template,
  crash,
}) {
  if (!FEEDBACK_KINDS.includes(kind)) throw Error(`Feedback has no kind called ${String(kind).slice(0, 20)}.`);
  const text = cleaned(message).trim();
  if (!text) throw Error('Feedback cannot be empty.');
  if ([...text].length > MAX_MESSAGE_CHARACTERS) throw Error('Feedback can be at most 8,000 characters.');

  const payload = {
    schema_version: 1,
    id,
    occurred_at: toSecond(now),
    kind,
    message: text,
    client,
    ...(kind === 'template' ? { template: templateField(template) } : {}),
    ...(kind === 'crash' && crash ? { crash } : {}),
  };
  const body = JSON.stringify(payload, null, 2);
  if (Buffer.byteLength(body) > MAX_FEEDBACK_BYTES) throw Error('Feedback can be at most 64 KiB.');

  return { id, kind, body, sha256: sha256Hex(Buffer.from(body, 'utf8')) };
}

/**
 * What follows `/feedback` in Chat. A kind can come first, lowercase or with a colon, as in `idea pin reports` or
 * `Idea: pin reports`, so a message that starts with "Bug in" keeps its words. Anything else is a bug.
 */
export function chatDraft(words, { now = Date.now(), client, home } = {}) {
  const text = String(words ?? '').trim();
  const named = text.match(KIND_FIRST) ?? text.match(KIND_WITH_COLON);
  const kind = named ? named[1].toLowerCase() : 'bug';
  const message = named ? named[2] : text;
  return draftFeedback({ kind, message: redact(message, { home }), now, client });
}

/** The exact bytes and their SHA-256, under a line that says redaction is best effort. Not sending comes first. */
export function feedbackQuestion(draft, { intro = "Send this to hobkin's developers?" } = {}) {
  const lines = [
    `${intro} Only these bytes go, and only after your yes. Redaction is best effort, so check it for anything private first.`,
    draft.body,
    `SHA-256 ${draft.sha256}`,
  ];
  return {
    question: lines.join('\n\n'),
    choices: [
      { value: 'keep', label: "Don't send" },
      { value: 'send', label: 'Send it' },
    ],
  };
}
