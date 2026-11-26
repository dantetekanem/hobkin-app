import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { answerPutOff, filePutOff } from './decisions.mjs';

const LONGEST_TYPED = 1000;
const LATER = 'The user put this off. It waits in Action Items with its choices, and their answer comes to you in Chat. Change nothing for it until then, and do not ask it again.';

const text = maxLength => Type.String({ minLength: 1, maxLength, pattern: '^[^\\x00-\\x1f\\x7f-\\x9f]+$' });
const parameters = Type.Object({
  question: text(240),
  choices: Type.Array(Type.Object({
    value: text(80),
    label: text(80),
  }, { additionalProperties: false }), { minItems: 2, maxItems: 6 }),
}, { additionalProperties: false });

const answersPath = root => join(root, 'answers.jsonl');

/** What the user answered the main agent, private beside decisions.jsonl: the question, the label they chose or the words they typed, and when. */
function keepAnswer(root, question, { answer, typed }) {
  const record = {
    at: new Date().toISOString(),
    question,
    ...(typed ? { typed: typed.slice(0, LONGEST_TYPED) } : { chose: answer.label }),
  };
  try {
    appendFileSync(answersPath(root), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  } catch {
    // The answer still reaches the agent, and only this record of it is lost.
  }
}

/** Oldest first. A line cut short by a crash costs that line and nothing else. */
export function readAnswers(root) {
  const file = answersPath(root);
  if (!existsSync(file)) return [];

  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return lines.flatMap(line => {
    try {
      const answer = JSON.parse(line);
      return answer && typeof answer === 'object' ? [answer] : [];
    } catch {
      return [];
    }
  });
}

/** Put off, it waits in Action Items. A log that cannot be written leaves it a plain non-answer, as it was. */
function putOff(root, request) {
  if (!root) return { status: 'cancelled' };
  try {
    return { status: 'later', id: filePutOff(root, request).id, message: LATER };
  } catch {
    return { status: 'cancelled' };
  }
}

/** Answered on the sheet, it leaves Action Items if it was waiting there from an earlier time it was put off. */
function settleWaiting(root, request, { answer, typed }) {
  try {
    answerPutOff(root, request.question, { value: answer?.value, typed });
  } catch {
    // The answer still reaches the agent, and the item waits until it is answered there.
  }
}

/**
 * With a data root, each answer is kept there, so it outlasts the conversation that asked, and a question the user put off, or left until
 * its time on screen ran out, waits in Action Items instead of being lost. A stopped turn is the user's own end to it, and files nothing.
 */
export function createQuestionTool(askQuestion, root = null) {
  return defineTool({
    name: 'ask_question',
    label: 'Ask a question',
    description: 'Ask the user one question with selectable answers. They can type their own answer instead, returned as `typed`, or put it off, returned as `later`: it then waits in Action Items, and their answer comes to you in Chat.',
    parameters,
    async execute(_id, request, signal) {
      if (!Check(parameters, request) || !request.question.trim()
        || request.choices.some(choice => !choice.value.trim() || !choice.label.trim())
        || new Set(request.choices.map(choice => choice.value)).size !== request.choices.length) {
        throw Error('Invalid question: provide 2–6 distinct choices and bounded plain text.');
      }
      const selected = signal?.aborted ? null : await askQuestion?.({ ...structuredClone(request), other: true }, signal);
      let details;
      if (selected === undefined) details = { status: 'unavailable' };
      else if (signal?.aborted) details = { status: 'cancelled' };
      else if (selected === null) details = putOff(root, request);
      else if (selected.typed) details = { status: 'answered', typed: selected.typed };
      else {
        const answer = request.choices.find(choice => choice.value === selected);
        if (!answer) throw Error('Selected choice does not belong to this question.');
        details = { status: 'answered', answer: { ...answer } };
      }
      if (root && details.status === 'answered') {
        keepAnswer(root, request.question, details);
        settleWaiting(root, request, details);
      }
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    },
  });
}
