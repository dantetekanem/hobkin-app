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

/** The first line of `text` that says something, as plain words. It reads lines only up to that one, however long the text. */
function firstSayable(text: string): string | undefined {
  let start = 0
  while (true) {
    const end = text.indexOf('\n', start)
    const line = plain(end < 0 ? text.slice(start) : text.slice(start, end))
    if (sayable(line)) return line
    if (end < 0) return undefined
    start = end + 1
  }
}

/**
 * Something long, such as an agent's latest message, as one plain line: its first line that says something, cut to
 * its first sentence, and past `LONGEST` characters ended at a word with "…". Undefined when no line says anything.
 */
export function summaryLine(text: string): string | undefined {
  const line = firstSayable(text)
  if (!line) return undefined
  const sentence = /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line
  if (sentence.length <= LONGEST) return sentence
  return `${sentence.slice(0, LONGEST - 1).replace(/\s*\S*$/, '').replace(/[\s,;:—–-]+$/, '')}…`
}
