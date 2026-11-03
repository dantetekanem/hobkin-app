import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { byRank } from './store.mjs';

const MAX_TEXT_LENGTH = 280;
const MAX_NOTE_PROPOSALS = 40;
const MAX_FINISHED_LINE = 280;

const mainScript = fileURLToPath(new URL('../main.mjs', import.meta.url));
const shellWord = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const pad = value => String(value).padStart(2, '0');
const brief = text => {
  const plain = String(text ?? '').replace(/\s+/g, ' ').trim();
  return plain.length > MAX_TEXT_LENGTH ? `${plain.slice(0, MAX_TEXT_LENGTH - 1)}…` : plain;
};
const sentence = text => (/[.!?…]$/.test(text) ? text : `${text}.`);

export const shortPath = path => {
  const text = String(path ?? '');
  const home = homedir();
  return text === home || text.startsWith(`${home}/`) ? `~${text.slice(home.length)}` : text;
};

/** An exact command, so an agent's answer lands in this home whatever is on its path. */
export const hobkinCommand = (root, subcommand) => `${shellWord(process.execPath)} ${shellWord(mainScript)} ${subcommand} --home ${shellWord(root)}`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 24 * 60 * 60000;

/** Today or tomorrow says enough for a next look. Anything further off, such as a week window's reset, names its day. */
export const lookTime = (at, now) => {
  const date = new Date(at);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDayAs = other => date.toDateString() === new Date(other).toDateString();
  if (sameDayAs(now)) return `${time} today`;
  if (sameDayAs(now + DAY_MS)) return `${time} tomorrow`;
  return `${time} on ${WEEKDAYS[date.getDay()]}`;
};

const proposalLine = ({ name, slug, level, summary, found, reason }, index) => {
  const details = [summary, found, reason].filter(Boolean).map(text => sentence(brief(text))).join(' ');
  return `${index + 1}. **${brief(name ?? slug)}**, ${level}${details ? `: ${details}` : ''}`;
};

/** What Chat says when a look ends. Returns nothing when there is nothing to tell. */
export function discoveryMessage({ folder, proposals, status, reason, left, nextAt, now }) {
  const where = `\`${shortPath(folder)}\``;
  const why = sentence(brief(reason));
  const proposing = proposals.length === 1 ? '1 project' : `${proposals.length} projects`;
  const when = nextAt ? lookTime(nextAt, now) : '';
  const nextLook = when ? ` It looks again at ${when}.` : '';
  const stopped = left?.length ? ` with ${left.length} of its folders left` : '';
  const openings = {
    offered: `Work mode proposes ${proposing}.`,
    finished: proposals.length ? `Work mode looked through ${where} and proposes ${proposing}.`
      : `Work mode looked through ${where} and has nothing to propose: ${why}${nextLook}`,
    failed: `Work mode could not finish looking in ${where}: ${why}${when ? ` It tries again at ${when}.` : ''}`,
    unfinished: `Work mode stopped looking in ${where} before it finished${stopped}: ${why}${nextLook || ' It carries on from there next time.'}`,
    cancelled: `Looking in ${where} was cancelled.`,
  };
  if (proposals.length) {
    return [
      openings[status],
      '',
      ...proposals.map(proposalLine),
      '',
      'Which ones should it take? Say so here, or use the Work Mode tab. Nothing starts on a project until it is picked.',
    ].join('\n');
  }
  return status === 'cancelled' ? '' : openings[status];
}

const heardAction = ({ at, did, project, item, title, pr }) => ({ at, did, project, item, title, pr });

/**
 * The main agent never sees what hobkin posts in Chat, so what a post asks, and what the user did from a card, travels with the user's next message.
 * JSON keeps the block on one line, and escaping `</` means project text can never end it early.
 */
export function workNote({ projects = [], allowanceRequest, pause, review, enabled, shipFirst, sessions = [], userDid = [] }, commands) {
  const proposals = projects.filter(project => project.state === 'proposed').toSorted(byRank).slice(0, MAX_NOTE_PROPOSALS)
    .map(({ slug, name, level, summary, path }, index) => ({ position: index + 1, slug, name, level, summary: brief(summary), path }));
  const shipping = enabled && shipFirst?.holding ? shipFirst : null;
  if (!proposals.length && !allowanceRequest && !pause && !review && !shipping && !sessions.length && !userDid.length) return '';

  const allowance = allowanceRequest && {
    proposed: allowanceRequest.proposed,
    used: allowanceRequest.used,
    limit: allowanceRequest.limit,
    hourlyShareIfRaised: allowanceRequest.hourShare,
    lasts: 'until midnight',
    reason: allowanceRequest.reason,
  };
  const details = {
    ...(proposals.length ? { proposals } : {}),
    ...(allowance ? { allowance } : {}),
    ...(pause ? { pause: { limitHit: pause.kind, facts: pause.line } } : {}),
    ...(review ? { review: { stale: review.stale, facts: review.message } } : {}),
    ...(shipping ? { shipFirst: { finishedAndWaiting: shipping.pile, newWorkStartsUnder: shipping.bar, facts: shipping.line } } : {}),
    ...(sessions.length ? { sessions } : {}),
    ...(userDid.length ? { userDid: userDid.map(heardAction) } : {}),
    commands,
  };
  return `<hobkin-work>\n${JSON.stringify(details).replaceAll('</', '<\\/')}\n</hobkin-work>\n\n`;
}

export const withoutWorkNote = text => text.replace(/^<hobkin-work>\n.*\n<\/hobkin-work>\n\n/, '');

/** One quiet line in Chat for a finished run. It is marked so a row of them can fold. */
export const finishedLine = (id, title, message, at) => {
  const line = `${title}: ${message}`.slice(0, MAX_FINISHED_LINE);
  return { id, role: 'notice', content: line, line, finished: true, tone: 'quiet', at };
};

const foldedInto = (older, newer) => {
  const earlier = (older.earlier ?? 0) + (newer.earlier ?? 0) + 1;
  return { ...newer, earlier, content: `${newer.line} ${earlier} more finished, in Reports.` };
};

/** A busy day finishes many runs, and Chat keeps 100 messages. A row of these takes one place and shows the newest, so they can never push the conversation out. */
export function foldFinishedLines(messages) {
  const kept = [];
  for (const message of messages) {
    const last = kept.at(-1);
    if (message.finished && last?.finished) kept[kept.length - 1] = foldedInto(last, message);
    else kept.push(message);
  }
  return kept;
}
