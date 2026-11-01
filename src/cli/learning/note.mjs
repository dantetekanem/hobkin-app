import { withoutWorkNote } from '../work/chat.mjs';

const BLOCK = /^<hobkin-learning>\n(.*)\n<\/hobkin-learning>\n\n/;
const textOf = ({ content }) => (typeof content === 'string' ? content
  : (content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n'));

/**
 * The tail of the conversation is the one place new text costs no cache: everything before it stays byte for byte
 * what the provider already holds. As with `<hobkin-work>`, JSON keeps it on one line and escaping `</` keeps it closed.
 */
export function learningNote({ lines, proposals = [] }) {
  const details = { learning: lines, ...(proposals.length ? { proposals } : {}) };
  return `<hobkin-learning>\n${JSON.stringify(details).replaceAll('</', '<\\/')}\n</hobkin-learning>\n\n`;
}

export const withoutLearningNote = text => text.replace(BLOCK, '');

/** An empty note takes back the last one, for lessons that were cleared or a setting turned off. */
export const NO_LEARNING = learningNote({ lines: [] });

/** The last note the agent can still see. A compaction removes it from here, so it is sent again. */
export function noteInContext(messages) {
  const latest = messages.findLast(message => message.role === 'user' && BLOCK.test(withoutWorkNote(textOf(message))));
  return latest ? withoutWorkNote(textOf(latest)).match(BLOCK)[0] : '';
}
