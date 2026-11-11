/**
 * How much of a reply being written is shown: a finished line or Markdown block at a time, never the line still
 * being written, so the reply arrives in pieces that are already what they will be. What shows is always the
 * start of what arrived, and once the reply ends all of it shows. Pure, so the rule is tested without a window.
 */

/** A line that opens or closes a code block: three or more backticks or tildes. */
const FENCE = /^\s*(`{3,}|~{3,})/

/** When this many pieces wait, more than one shows at a time, so a fast reply is never left far behind. */
const BEHIND = 4

const closes = (line: string, fence: string) => line.trim().length >= fence.length && [...line.trim()].every((char) => char === fence[0])

/**
 * The places the shown text may end, in order: after each finished line, except a line that would draw
 * differently once the next one arrives. A blank line, the opening of a code block and a table's header row
 * each wait and show with the line after them.
 */
function revealPoints(text: string): number[] {
  const points: number[] = []
  let fence: string | null = null
  let previous = ''
  for (let start = 0, end = text.indexOf('\n'); end >= 0; start = end + 1, end = text.indexOf('\n', start)) {
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
