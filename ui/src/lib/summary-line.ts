/** How long a one-line summary may run before it ends at a word. */
const LONGEST = 140

/** A line of Markdown as plain words: links keep their text, and marks for bold, code, headings, quotes and lists go. */
const plain = (line: string) =>
  line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`|~~/g, '')
    .replace(/^\s*(#{1,6}|[-*+>]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()

/** A rule or a table row says nothing on its own. */
const sayable = (line: string) => line.length > 0 && !/^[-=_*\s]+$/.test(line) && !line.startsWith('|')

/**
 * Something long, such as an agent's latest message, as one plain line: its first line that says something, cut to
 * its first sentence, and past `LONGEST` characters ended at a word with "…". Undefined when no line says anything.
 */
export function summaryLine(text: string): string | undefined {
  const line = text.split('\n').map(plain).find(sayable)
  if (!line) return undefined
  const sentence = /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line
  if (sentence.length <= LONGEST) return sentence
  return `${sentence.slice(0, LONGEST - 1).replace(/\s*\S*$/, '').replace(/[\s,;:—–-]+$/, '')}…`
}
