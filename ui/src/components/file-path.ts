/** How wide a text draws, in CSS pixels. */
export type Measure = (text: string) => number

/** What stands where a cut path left its front out. */
export const MARK = '…'

const isSeparator = (char: string | undefined) => char === '/' || char === '\\'

/** Where a path's last name begins: after the last separator that has a name after it. 0 for a path with no folder. */
function nameStart(path: string): number {
  const trimmed = path.replace(/[\\/]+$/, '')
  return Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1
}

/**
 * A file path cut from its front to fit `width`, so its file name, at the end, is what stays. A path that fits is
 * whole. One that does not loses its first folders one at a time, a mark standing where they were
 * (`…/models/change.rb`), keeping as many of its last folders as fit. With no room for the mark and the name
 * together, the name shows alone. Only a name wider than the row is cut, from its front too (`…ange.rb`), so its
 * end and its extension stay. Before its row is measured (`width` 0) the path is whole.
 */
export function fitPath(path: string, width: number, measure: Measure): string {
  if (!(width > 0)) return path
  const fits = (text: string) => measure(text) <= width
  if (fits(path)) return path

  const name = nameStart(path)
  // Each cut keeps the separator before what it leaves, and one at the very front would leave nothing out.
  for (let at = 1; at < name; at++) {
    if (!isSeparator(path[at])) continue
    const cut = MARK + path.slice(at)
    if (fits(cut)) return cut
  }

  const file = path.slice(name)
  if (name > 0 && fits(file)) return file
  return nameEnd(file, fits)
}

/** The longest end of a name that fits after the mark, or the mark alone. A shorter end is never wider, so it is searched by halves. */
function nameEnd(name: string, fits: (text: string) => boolean): string {
  const letters = [...name]
  const endOf = (count: number) => MARK + letters.slice(letters.length - count).join('')

  let low = 0
  let high = letters.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(endOf(middle))) low = middle
    else high = middle - 1
  }
  return endOf(low)
}

/**
 * The parts of a path as `fitPath` showed it: the front the row holds unseen, whether the mark stands before the
 * rest, and the rest, which is the path's end. The unseen front and the rest make the whole path, so a copy of the
 * row takes all of it.
 */
export function cutParts(path: string, shown: string): { hidden: string; mark: boolean; kept: string } {
  if (shown === path) return { hidden: '', mark: false, kept: path }
  const mark = shown.startsWith(MARK)
  const kept = mark ? shown.slice(MARK.length) : shown
  return { hidden: path.slice(0, path.length - kept.length), mark, kept }
}
