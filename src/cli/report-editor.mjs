import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { reportTriage } from './reports.mjs';

// A finished report waits for this, so a stuck editor can only hold it back this long.
const TIME_LIMIT_MS = 180000;
const MOST_PROMPT_BYTES = 65536;

const CODE = /`([^`\n]+)`/g;
const LINK = /https?:\/\/[^\s)>\]]+/g;
const NUMBER = /\d[\d.,:]*\d|\d/g;

/** The parts of a report an edit may not touch: words can change, and these are the evidence. */
const fixedParts = text => [
  ...[...text.matchAll(CODE)].map(([, code]) => code),
  ...(text.match(LINK) ?? []),
  ...(text.match(NUMBER) ?? []),
];

const triageOf = text => reportTriage({ status: 'completed', result: { text } });
const triageLevel = text => triageOf(text)?.level;

const allKept = (from, into) => fixedParts(from).every(part => into.includes(part));

function changesNoFact(draft, edited) {
  return triageLevel(edited) === triageLevel(draft)
    && triageOf(edited)?.next === triageOf(draft)?.next
    && allKept(draft, edited)
    && allKept(edited, draft);
}

function isReportToEdit(result) {
  if (result.status !== 'completed') return false;

  const level = triageLevel(result.text);
  return Boolean(level) && level !== 'nothing';
}

/**
 * Hobkin's own last pass over a report, whoever wrote it, using the guide in `prompts/humanizer.md`. It can only ever improve the
 * words: anything that goes wrong leaves the report as it was written. The draft stays in the session of the job named by `editedBy`.
 */
export async function editReport(result, { root, binding, runHarness, signal, timeLimitMs = TIME_LIMIT_MS }) {
  if (!isReportToEdit(result) || signal?.aborted) return result;
  if (Buffer.byteLength(result.text) > MOST_PROMPT_BYTES) return result;

  try {
    const jobs = join(root, 'jobs');
    mkdirSync(jobs, { recursive: true, mode: 0o700 });

    const id = randomUUID();
    const limit = AbortSignal.timeout(timeLimitMs);
    const edit = await runHarness({
      ...binding,
      id,
      harness: 'pi',
      purpose: 'humanizer',
      cwd: root,
      prompt: result.text,
      sessionFile: join(jobs, `${id}.jsonl`),
      signal: signal ? AbortSignal.any([signal, limit]) : limit,
    });

    const usable = edit.status === 'completed' && changesNoFact(result.text, edit.text ?? '');
    return usable ? { ...result, text: edit.text, editedBy: id } : result;
  } catch {
    return result;
  }
}
