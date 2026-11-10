/**
 * Local file paths in Markdown (_specs/027-links-and-files). A full path or one that starts with `~/` is shown as a
 * link that opens the viewer. No JSX here, so the tests can run it with Node alone.
 */

/**
 * A path in running text. Only `~/` and the folders a Mac has at its top are taken, so `and/or`, `/api/users` and
 * a route in prose stay words. A path in a link's own destination needs none of this: any full path counts there.
 */
const PATH =
  /(?<![\w.:/@~-])(?:~|\/(?:Users|Volumes|private|tmp|var|opt|etc|usr|home|Applications|Library|System|Developer))(?:\/[\w.@+%~-]+)+/g

/** A sentence's end is not part of the path before it. */
const TRAILING = /[.,;:!?%+~@-]+$/

export type PathPiece = { text: string } | { path: string }

/** Text cut into plain words and the paths among them, in order. */
export function splitPaths(text: string): PathPiece[] {
  const pieces: PathPiece[] = []
  let from = 0
  for (const match of text.matchAll(PATH)) {
    const path = match[0].replace(TRAILING, '')
    if (!/\/[^/]+$/.test(path)) continue
    if (match.index > from) pieces.push({ text: text.slice(from, match.index) })
    pieces.push({ path })
    from = match.index + path.length
  }
  if (from < text.length || pieces.length === 0) pieces.push({ text: text.slice(from) })
  return pieces
}

/** The file a link destination names: a full path or one that starts with `~/`. Anything else, such as an address or `#top`, is null. */
export function localPathOf(href: string | undefined | null): string | null {
  if (!href || !/^(\/(?!\/)|~\/)/.test(href)) return null
  try {
    return decodeURI(href)
  } catch {
    return href
  }
}

interface Node {
  type: string
  value?: string
  url?: string
  children?: Node[]
}

const LEAVE_ALONE = new Set(['link', 'linkReference', 'definition', 'code', 'html'])

/** A remark plugin: a path in text, or a whole inline code that is one, becomes a link to the file. */
export function remarkFilePaths() {
  const link = (path: string, child: Node): Node => ({ type: 'link', url: path, children: [child] })
  const walk = (parent: Node) => {
    if (!parent.children || LEAVE_ALONE.has(parent.type)) return
    parent.children = parent.children.flatMap((child): Node[] => {
      if (child.type === 'text' && child.value) {
        const pieces = splitPaths(child.value)
        if (pieces.length === 1 && 'text' in pieces[0]!) return [child]
        return pieces.map((piece): Node => ('path' in piece ? link(piece.path, { type: 'text', value: piece.path }) : { type: 'text', value: piece.text }))
      }
      if (child.type === 'inlineCode' && child.value && parent.type !== 'link') {
        const pieces = splitPaths(child.value)
        const [only] = pieces
        if (pieces.length === 1 && only && 'path' in only && only.path === child.value) return [link(child.value, child)]
        return [child]
      }
      walk(child)
      return [child]
    })
  }
  return (tree: Node) => walk(tree)
}
