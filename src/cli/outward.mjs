/*
 * Which tool calls act outward in the user's name, and whether a standing rule or the user's own ask allows each one
 * (075-chief-of-staff S17). Pure: the guard extension (`outward-guard-extension.mjs`) reads the rules and records.
 */

/** What an outward call does: sends in the user's name, commits their time on a calendar, spends, deletes, or posts. */
export const OUTWARD_KINDS = Object.freeze(['send', 'calendar-write', 'spend', 'delete', 'post']);
export const OUTWARD_VERDICTS = Object.freeze(['allowed-by-rule', 'allowed-by-ask', 'would-block']);

/**
 * The kinds of work that stay at recommend or above unless the user has a standing rule: the outward kinds, committing the user's time,
 * anything irreversible, and anything about health, money or law, with the plain words a task class or a card's kind uses for them. The
 * autonomy ledger reads this list too (`autonomy.mjs`), so the two cannot drift.
 */
export const GUARDED_KINDS = Object.freeze([
  ...OUTWARD_KINDS,
  'email', 'reply', 'message', 'invite', 'pay', 'invoice', 'purchase', 'publish',
  'commit-time', 'irreversible', 'tax', 'law', 'legal', 'health', 'medical', 'money', 'bank',
]);

/**
 * Whether a task class or a card's kind is guarded: one of its words, split on `:` and `-`, is a guarded kind, or a guarded kind of two
 * words is two of its words in a row. `send-email` and `code-branch:delete` are guarded, and `sender-check` and `calendar-read` are not.
 */
export function isGuardedKind(kind) {
  if (typeof kind !== 'string') return false;
  const words = kind.split(/[:-]/);
  return GUARDED_KINDS.some(guarded => {
    const parts = guarded.split('-');
    return words.some((_, start) => parts.every((part, offset) => words[start + offset] === part));
  });
}

// A tool's name as words: `mcp__gmail__gmail_sendDraft` is mcp, gmail, gmail, send, draft.
const wordsOf = name => name.replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z\d]+/).filter(Boolean);

// The first verb in a tool's name says what it does. A reading verb says it only reads, so `list_post_comments` is not a post.
const VERBS = {
  send: 'send', reply: 'send', forward: 'send',
  post: 'post', publish: 'post', tweet: 'post',
  pay: 'spend', buy: 'spend', purchase: 'spend', checkout: 'spend',
  delete: 'delete', trash: 'delete',
  get: null, list: null, search: null, read: null, find: null, fetch: null, query: null, download: null,
};
// On a calendar these change what the user is committed to, and what the other people were told.
const CALENDAR = new Set(['calendar', 'gcal', 'event']);
const CALENDAR_VERBS = new Set(['create', 'update', 'delete', 'respond', 'move', 'cancel', 'accept', 'decline', 'invite']);

function toolKind(name) {
  const words = wordsOf(name);
  const calendar = words.some(word => CALENDAR.has(word));
  for (const word of words) {
    if (calendar && CALENDAR_VERBS.has(word)) return 'calendar-write';
    if (Object.hasOwn(VERBS, word)) return VERBS[word];
  }
  return null;
}

// A command that starts a mail program, or tells an app by AppleScript to send.
const MAIL = /(?:^|[;&|`(])\s*(?:sudo\s+)?(?:\S*\/)?(?:sendmail|mailx?|mutt|msmtp)(?=\s|$)/m;
const APPLESCRIPT_SEND = /\bosascript\b[\s\S]*\bsend\b/;
// curl or wget writing over HTTP. A request to this machine stays on it.
const LOCAL = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b|\[::1\]/;
const METHOD = /(?:^|\s)(?:-X|--request|--method)[=\s]*['"]?([A-Za-z]+)/;
const CURL_BODY = /\s(?:-d|-F|-T|--data(?:-[a-z]+)?|--form(?:-string)?|--json|--upload-file)(?=[\s='"]|$)/;
const WGET_BODY = /\s--(?:post|body)-(?:data|file)\b/;

function commandKind(command) {
  if (MAIL.test(command) || APPLESCRIPT_SEND.test(command)) return 'send';
  for (const part of command.split(/\|\||&&|[|;\n]/)) {
    const body = /\bcurl\b/.test(part) ? CURL_BODY : /\bwget\b/.test(part) ? WGET_BODY : null;
    if (!body || LOCAL.test(part)) continue;
    const method = METHOD.exec(part)?.[1].toUpperCase();
    if (method === 'DELETE') return 'delete';
    if (['POST', 'PUT', 'PATCH'].includes(method) || body.test(part)) return 'post';
  }
  return null;
}

/** The outward kind of one tool call, from its name and, for `bash`, its command. Null for anything else. */
export function outwardKind(toolName, args) {
  if (typeof toolName !== 'string') return null;
  if (toolName === 'bash') return typeof args?.command === 'string' ? commandKind(args.command) : null;
  return toolKind(toolName);
}

// A standing rule allows an outward kind when the user said to allow exactly that kind.
const allows = (rule, kind) => rule?.kind === 'outward' && rule.then === 'allow' && (rule.match === kind || rule.match?.kind === kind);

/** What a guard would do with an outward call: let a standing rule or the user's own ask allow it, or block it. */
export function outwardVerdict({ kind, rules, askCovered }) {
  if (Array.isArray(rules) && rules.some(rule => allows(rule, kind))) return 'allowed-by-rule';
  return askCovered === true ? 'allowed-by-ask' : 'would-block';
}

// What hobkin adds to a message comes in `<hobkin-…>` blocks, and a turn hobkin starts by itself is one block.
const HOBKIN_BLOCK = /<(hobkin-[a-z-]+)>[\s\S]*?<\/\1>/g;
const ASKS = {
  send: /\b(?:send|email|e-mail|mail|reply|forward)\b/i,
  'calendar-write': /\b(?:invite|schedule|book|accept|decline|reschedule|rsvp)\b/i,
  spend: /\b(?:buy|pay|purchase|order)\b/i,
  delete: /\b(?:delete|remove|trash)\b/i,
  post: /\b(?:post|publish|tweet|comment)\b/i,
};

// A plain negation cancels every ask in its sentence: "don't send it", "do not reply", "never post this", "send it, but not yet".
const NEGATION = /\b(?:don['’]?t|do not|never|not yet)\b/i;
const SENTENCE_END = /[.!?;\n]+/;

/**
 * Whether the user's own words in a message ask for this kind of action: a sentence that names it and holds no plain negation. "Continue" or
 * "yes" alone asks for none.
 */
export const askCovers = (kind, text) => Object.hasOwn(ASKS, kind) && typeof text === 'string'
  && text.replace(HOBKIN_BLOCK, '').split(SENTENCE_END).some(sentence => ASKS[kind].test(sentence) && !NEGATION.test(sentence));
