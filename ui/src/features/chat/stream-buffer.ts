/**
 * How much of a reply being written is shown: its finished lines, and the line still being written up to its last
 * whole word, so its first words show as soon as they arrive. What would draw as something else once more arrives
 * waits for what settles it. What shows is always the start of what arrived, and once the reply ends all of it
 * shows. Pure, so the rule is tested without a window.
 */

/** A line that opens or closes a code block: three or more backticks or tildes. */
const FENCE = /^\s*(`{3,}|~{3,})/

/** When this many pieces wait, more than one shows at a time, so a fast reply is never left far behind. */
const BEHIND = 4

/** What begins a line before its words: indentation, quote marks, list and task markers, and a heading's hashes. */
const MARKERS = /^(?:\s*(?:>|[-*+](?=\s)|\d{1,9}[.)](?=\s)|#{1,6}(?=\s)|\[[ xX]\](?=\s)))*\s*/

const SPACE = /\s/
const PUNCTUATION = /[\p{P}\p{S}]/u

const closes = (line: string, fence: string) => line.trim().length >= fence.length && [...line.trim()].every((char) => char === fence[0])

/** The length of `words` up to the end of its last whole word, the last one with a space after it. Null with none. */
const wordEnd = (words: string): number | null => /^([\s\S]*\S)\s/.exec(words)?.[1]!.length ?? null

/** Where the run of `size` backticks that closes a code span ends, looking from `from`. Null while it is still open. */
function codeEnd(words: string, from: number, size: number): number | null {
  for (let at = from; at < words.length; ) {
    if (words[at] !== '`') {
      at += 1
      continue
    }
    let run = 1
    while (words[at + run] === '`') run += 1
    if (run === size) return at + run
    at += run
  }
  return null
}

/**
 * Where the first emphasis, code span or link still open in a line's words begins, or null when each one closed.
 * Shown open, it would draw as its marks and then change once it closes. Emphasis opens and closes by CommonMark's
 * flanking rules, so `2 * 3` and `snake_case` open nothing, and a single tilde, as in `~5 minutes`, is plain text.
 */
function openAt(words: string): number | null {
  const open: { mark: string; at: number }[] = []
  for (let at = 0; at < words.length; ) {
    const char = words[at]!
    let size = 1
    while (words[at + size] === char) size += 1
    if (char === '\\') {
      at += 2
    } else if (char === '`') {
      const end = codeEnd(words, at + size, size)
      if (end === null) return open[0]?.at ?? at
      at = end
    } else if (char === '*' || char === '_' || (char === '~' && size === 2)) {
      // What is past the words is a space: they end at a whole word.
      const before = words[at - 1] ?? ' '
      const after = words[at + size] ?? ' '
      const left = !SPACE.test(after) && (!PUNCTUATION.test(after) || SPACE.test(before) || PUNCTUATION.test(before))
      const right = !SPACE.test(before) && (!PUNCTUATION.test(before) || SPACE.test(after) || PUNCTUATION.test(after))
      const opens = char === '_' ? left && (!right || PUNCTUATION.test(before)) : left
      const shuts = char === '_' ? right && (!left || PUNCTUATION.test(after)) : right
      const mark = char.repeat(size)
      const match = shuts ? open.findLastIndex((item) => item.mark === mark) : -1
      if (match !== -1) open.length = match
      else if (opens) open.push({ mark, at })
      at += size
    } else if (char === '[' || (char === '!' && words[at + 1] === '[')) {
      open.push({ mark: '[', at })
      at += char === '!' ? 2 : 1
    } else if (char === ']') {
      const match = open.findLastIndex((item) => item.mark === '[')
      if (match !== -1 && words[at + 1] === '(') {
        // A link: it is open until its address closes, and what opened inside its words ends with it.
        const end = words.indexOf(')', at + 2)
        if (end === -1) return open[0]!.at
        open.length = match
        at = end + 1
      } else {
        // Brackets with no address after them are only text.
        if (match !== -1) open.splice(match, 1)
        at += 1
      }
    } else {
      at += size
    }
  }
  return open[0]?.at ?? null
}

/**
 * How much of the line still being written may show: up to its last whole word. Inside a code block that is all.
 * Elsewhere a code block's opening and a table's lines wait for the whole line, a heading, list item or quote waits
 * for its first word, and emphasis, code or a link still open holds back the rest of the line from where it opens.
 * Null when nothing of the line may show yet.
 */
function lineEnd(line: string, fence: string | null): number | null {
  if (fence) return wordEnd(line)
  if (FENCE.test(line) || line.includes('|')) return null
  const from = MARKERS.exec(line)![0].length
  const words = line.slice(from)
  const end = wordEnd(words)
  if (end === null) return null
  const open = openAt(words.slice(0, end))
  const safe = open === null ? end : wordEnd(words.slice(0, open))
  return safe === null ? null : from + safe
}

/**
 * The places the shown text may end, in order: after each finished line, except a line that would draw
 * differently once the next one arrives, and last inside the line still being written (`lineEnd`). A blank line,
 * the opening of a code block and a table's header row each wait and show with what comes after them.
 */
function revealPoints(text: string): number[] {
  const points: number[] = []
  let fence: string | null = null
  let previous = ''
  let start = 0
  for (let end = text.indexOf('\n'); end >= 0; start = end + 1, end = text.indexOf('\n', start)) {
    const line = text.slice(start, end)
    let waits: boolean
    if (fence) {
      if (closes(line, fence)) fence = null
      waits = false
    } else {
      fence = FENCE.exec(line)?.[1] ?? null
      // Without its divider, a table's header is a paragraph with bars in it.
      waits = fence !== null || !line.trim() || (line.includes('|') && !previous.includes('|'))
    }
    if (!waits) points.push(end + 1)
    previous = line
  }
  const tail = start < text.length ? lineEnd(text.slice(start), fence) : null
  if (tail !== null) points.push(start + tail)
  return points
}

/**
 * What to show next of a reply, given what is shown now. `done`: the reply ended, or failed, and all of it shows.
 * Otherwise the next piece shows, or a few when many wait. Text the model rewrote goes back to the last place
 * both versions agree on.
 */
export function nextReveal(text: string, shown: string, done: boolean): string {
  if (done) return text
  const points = revealPoints(text)
  let from = shown.length
  if (!text.startsWith(shown)) {
    let same = 0
    while (text[same] === shown[same]) same += 1
    from = points.findLast((point) => point <= same) ?? 0
  }
  const ahead = points.filter((point) => point > from)
  return text.slice(0, ahead.length ? ahead[Math.ceil(ahead.length / BEHIND) - 1] : from)
}
