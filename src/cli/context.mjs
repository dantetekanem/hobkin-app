import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runOutcomeText } from './reports.mjs';
import { assertPromptBytes, promptByteLimit } from './prompt-bounds.mjs';

const MAX_FILE_BYTES = 32768;

/** Explicit regular-file sources only. This bounds context, not the child's filesystem access. */
export async function buildContext(schedule, latestOutcome = null, memory = [], check = { memory: null, log: [] }, work = undefined) {
  const maxPromptBytes = promptByteLimit();
  const cwd = resolve(schedule.cwd);
  if (await realpath(cwd) !== cwd || !(await lstat(cwd)).isDirectory()) {
    throw Error('cwd must be a real directory without symlinks');
  }
  const sources = [];
  for (const reference of schedule.context) {
    const path = resolve(cwd, reference);
    const local = relative(cwd, path);
    if (isAbsolute(reference) || !local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
      throw Error('source escapes cwd');
    }
    let component = cwd;
    for (const part of local.split(sep)) {
      component = join(component, part);
      if ((await lstat(component)).isSymbolicLink()) throw Error('source symlinks are not allowed');
    }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        throw Error('source must be a regular file within the byte limit');
      }
      if (await realpath(path) !== path) throw Error('source path changed or contains a symlink');
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_FILE_BYTES) throw Error('source exceeded its byte limit');
      sources.push({ path: reference, text: buffer.subarray(0, bytesRead).toString('utf8') });
    } finally {
      await file.close();
    }
  }
  const envelope = {
    scope: {
      cwd,
      harness: schedule.harness,
      model: schedule.model,
      sources: schedule.context,
    },
    routine: { id: schedule.id, title: schedule.title, instructions: schedule.prompt },
    sources,
    directions: check.directions,
    memory,
    checkMemory: check.memory,
    log: check.log,
    latestOutcome: latestOutcome ? {
      status: latestOutcome.status,
      text: String(runOutcomeText(latestOutcome)).slice(0, 4096),
    } : null,
    ...(work ? { work } : { decide: check.decide, action: check.action, reportId: check.reportId }),
    // What started a workflow handed its run (065-integration-drops), such as a command's arguments and answer.
    ...(check.input === undefined ? {} : { input: check.input }),
  };
  let prompt = JSON.stringify(envelope);
  assertPromptBytes(prompt, maxPromptBytes, 'context envelope');
  // Lessons, then the index of hobkin's memories (057-shared-memory), go in the request, never the system prompt, so a
  // new lesson or memory leaves what every run shares cached. A run with no room for either still runs without it.
  let fuller = envelope;
  for (const [key, value] of [['learning', check.learning?.length ? check.learning : null], ['memories', check.memories || null]]) {
    if (!value) continue;
    const tried = JSON.stringify({ ...fuller, [key]: value });
    if (Buffer.byteLength(tried) > maxPromptBytes) continue;
    fuller = { ...fuller, [key]: value };
    prompt = tried;
  }
  return prompt;
}
