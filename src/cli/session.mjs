import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { injectedLessons } from './learning/store.mjs';
import { recordSessionStart } from './session-log.mjs';
import { assertTier } from './tiers.mjs';

const MAX_TITLE_LENGTH = 20;
// Two or three is a job. More than that is a batch the user should see as a list first, and 26 sessions once started from a guess.
const MOST_SESSIONS_UNASKED = 3;
const SESSION_WINDOW_MS = 30 * 60000;

const sessionName = title => {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, MAX_TITLE_LENGTH).replace(/^-|-$/g, '');
  return `hobkin-${words || 'session'}-${randomBytes(2).toString('hex')}`;
};

export async function readBrief(input) {
  const pieces = [];
  for await (const piece of input) pieces.push(Buffer.from(piece));
  return Buffer.concat(pieces).toString('utf8');
}

const handoffs = root => join(root, 'runtime', 'handoffs');
// A branch or a step that lives only in a report is lost work: nothing reviews, merges, deploys or closes it. So the session files them first.
const finishing = (root, report) => `\n\n## When you finish

Register each branch you made as finished work before you hand back: pipe \`{ "title": "...", "branch": "<branch>", "state": "branch", "summary": "...", "proof": "..." }\` to \`hobkin work item <project> --home ${root}\`, with \`"issue": { "repo": "owner/name", "number": 12 }\` when it is for a GitHub issue. The project is its name, slug or folder. hobkin then takes the branch through its review, the user's merge and deploy, and the issue's closing, so do not push, open a PR for or merge it unless this brief says to.

File every step still to do as work, never only in your report: pipe \`{ "key": "...", "kind": "fix", "title": "...", "brief": "..." }\` to the same command, or record it as the next action on the item this brief names.

End in one of three ways, and say which: done; waiting on one call only the user can make in the app, named exactly; or carrying on through the work you filed, named by item.

Write a short report of what you did to \`${report}\`, naming each branch and item, and make your last reply that report.
`;
const NOTHING_TO_KEEP = "A session runs as a job in hobkin's agents list: it takes messages while it works and ends when its work does, so there is nothing to keep open.";

// A brief can hold a whole conversation, and only a short line fits in the job's first message.
function saveBrief(root, name, brief, report) {
  const folder = handoffs(root);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, `${name}.md`);
  const lessons = injectedLessons(root);
  const learned = lessons.length ? `\n\n## Learned\n\n${lessons.join('\n')}\n` : '';
  writeFileSync(file, `${brief}${learned}${finishing(root, report)}`, { mode: 0o600 });
  return file;
}

/** Every session leaves its brief, so the folder already says how many started lately. */
function sessionsSince(root, time) {
  const folder = handoffs(root);
  if (!existsSync(folder)) return 0;
  const briefs = readdirSync(folder).filter(file => file.endsWith('.md') && !file.endsWith('.report.md'));
  return briefs.filter(file => statSync(join(folder, file)).mtimeMs >= time).length;
}

function assertNotABurst(root, now) {
  const started = sessionsSince(root, now - SESSION_WINDOW_MS);
  if (started < MOST_SESSIONS_UNASKED) return;
  throw Error(`${started} sessions started in the last 30 minutes. When the user's own words in chat asked for the work these sessions do, that ask is their yes: pass --approved and do not ask again. Otherwise show the user the exact list of what the next ones will do, ask with ask_question, and pass --approved only once they say yes to that list.`);
}

/** The running hobkin starts the session as a job of its own. The request is renamed into place, so it is never read half written. */
function requestJob(root, request) {
  const folder = join(root, 'runtime', 'session-requests');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, `${request.name}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(request), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

/**
 * Hands massive work to a full Pi session the user can watch. Nothing waits for it: the running hobkin takes the request and
 * runs it as one of its background jobs (`session-jobs.mjs`), shown in its agents list. `keep` is for a whole conversation the
 * user means to carry on in, and the command's `note` says the job still ends with its work. `wake` gives the main agent a turn
 * as soon as the session ends, so it can carry on without checking for the report on a timer. `tier` names the model the
 * work needs (`tiers.mjs`); a session with none is ordinary work.
 */
export async function startSession({ root, title = 'session', cwd = process.cwd(), brief, keep = false, wake = false, approved = false, tier, now = Date.now() }) {
  if (!brief.trim()) throw Error('A session needs a brief: pipe in what to do, what is known and what finished looks like.');
  if (tier !== undefined) assertTier(tier);
  if (keep && wake) throw Error('--wake is for work handed off to end with a report, and --keep is for a conversation the user carries on in, so leave one of them out.');
  if (!approved) assertNotABurst(root, now);
  const name = sessionName(title);
  const report = join(handoffs(root), `${name}.report.md`);
  saveBrief(root, name, brief, report);
  recordSessionStart(root, { name, title, report, ...(wake ? { wake } : {}) }, now);
  requestJob(root, { name, title, cwd: resolve(cwd), wake, ...(tier ? { tier } : {}) });
  return { name, report, watch: "hobkin's agents list, where it shows within a second while hobkin runs", ...(keep ? { note: NOTHING_TO_KEEP } : {}) };
}
