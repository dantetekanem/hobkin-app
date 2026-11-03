import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DAY_MS = 24 * 3600000;
const NEWEST_DAYS = 30;
const REASON_LENGTH = 400;

/** Where pi-auto-review keeps each review, one folder a session. */
export const reviewsFolder = () => join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), 'auto-review');

/** A review can start from one commit and read on to a later one, so its grade belongs to the last commit it read. */
function reviewedHead({ reviewedRange, revision, preflight }) {
  const head = typeof reviewedRange === 'string' ? reviewedRange.split(/\.{2,3}/).at(-1) : reviewedRange?.head;
  return head || revision || preflight?.head;
}

function gradeIn(file) {
  try {
    const { status, grades, ...review } = JSON.parse(readFileSync(file, 'utf8'));
    const { grade, rating, reason = '' } = grades?.merge ?? {};
    const head = reviewedHead(review);
    if (status !== 'complete' || !grade || !head) return null;
    return { head, grade, rating, reason: String(reason).slice(0, REASON_LENGTH) };
  } catch {
    // A review still being written, or one from another version, is no grade.
    return null;
  }
}

/** The merge grade of each commit a finished review read, from what is on disk. No model, and a missing folder is simply no grades. */
export function readReviewGrades({ folder = reviewsFolder(), now = Date.now() } = {}) {
  const grades = new Map();
  if (!existsSync(folder)) return grades;

  const oldest = now - NEWEST_DAYS * DAY_MS;
  const reviews = readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(({ name }) => readdirSync(join(folder, name))
      .filter(file => file.endsWith('.review.json'))
      .map(file => join(folder, name, file)));

  for (const file of reviews) {
    const modified = statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    const found = modified >= oldest ? gradeIn(file) : null;
    if (!found) continue;

    const { head, ...grade } = found;
    const known = grades.get(head);
    if (!known || modified > known.modified) grades.set(head, { ...grade, modified });
  }
  return grades;
}
