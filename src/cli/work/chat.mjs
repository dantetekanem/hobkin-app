import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { byRank } from './store.mjs';

const MAX_TEXT_LENGTH = 280;
const MAX_NOTE_PROPOSALS = 40;

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

/** A next look is never more than a day away, so today or tomorrow says enough. */
export const lookTime = (at, now) => {
  const date = new Date(at);
  const day = date.toDateString() === new Date(now).toDateString() ? 'today' : 'tomorrow';
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${day}`;
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

/**
 * The main agent never sees what Hobkin posts in Chat, so what a post asks travels with the user's next message.
 * JSON keeps the block on one line, and escaping `</` means project text can never end it early.
 */
export function workNote({ projects = [], allowanceRequest }, commands) {
  const proposals = projects.filter(project => project.state === 'proposed').toSorted(byRank).slice(0, MAX_NOTE_PROPOSALS)
    .map(({ slug, name, level, summary, path }, index) => ({ position: index + 1, slug, name, level, summary: brief(summary), path }));
  if (!proposals.length && !allowanceRequest) return '';

  const details = {
    ...(proposals.length ? { proposals } : {}),
    ...(allowanceRequest ? { allowance: { proposed: allowanceRequest.proposed, reason: allowanceRequest.reason } } : {}),
    commands,
  };
  return `<hobkin-work>\n${JSON.stringify(details).replaceAll('</', '<\\/')}\n</hobkin-work>\n\n`;
}

export const withoutWorkNote = text => text.replace(/^<hobkin-work>\n.*\n<\/hobkin-work>\n\n/, '');
