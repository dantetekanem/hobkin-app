import { readFileSync } from 'node:fs';

/**
 * Ludicrous mode's prompts, kept as Markdown in `src/prompts/` like every prompt hobkin has. A file of tasks holds one task under each
 * `## <name>` heading, with `{{name}}` where the conductor puts in what the task is about.
 */

const read = name => readFileSync(new URL(`../../prompts/${name}.md`, import.meta.url), 'utf8');

/** A whole prompt file: a role's system prompt. */
export const systemPrompt = name => read(name).trim();

/** One task from a file of tasks, filled in. A name with nothing to put in is an error, so no task goes out with a hole in it. */
export function taskPrompt(file, task, values) {
  const text = read(file);
  const start = text.indexOf(`\n## ${task}\n`);
  if (start < 0) throw Error(`${file}.md has no task ${task}.`);
  const body = text.slice(start + task.length + 5);
  const end = body.search(/\n## /);
  return (end < 0 ? body : body.slice(0, end)).trim().replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (values[name] === undefined || values[name] === null) throw Error(`The ${task} task needs ${name}.`);
    return String(values[name]);
  });
}
