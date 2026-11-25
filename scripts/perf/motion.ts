/**
 * The window's endless animations (spec 052, A6). Reads every CSS file under ui/src, lists each animation that runs
 * forever (`infinite`) with its file, line, selector and the properties its keyframes change, and fails one that
 * changes anything but `transform` or `opacity`, or that is set on a part of an SVG. WebKit runs only transform and
 * opacity of an HTML box on the compositor; anything else restyles, lays out and paints on the main thread every frame.
 * It also fails an endless animation under ui/src/avatar that is not under Lively (`:root[data-motion='lively']`): a face
 * and its crab play their motion for about two seconds when the mood changes, then rest (2026-11-23), because every
 * face loop that runs makes WebKit draw every frame. Lively is the one place a face may loop: the user asked on
 * 2026-11-24 "why hobkin is not animated if lively is on?", so under Lively the faces loop their moods as they did
 * before. A rule that only makes animations endless (`animation-iteration-count: infinite`, as Lively does to the faces)
 * is judged by what every animation its style sheet sets changes, since those are the ones it can make loop.
 * And it fails an endless animation on a line's glow (`aa-glow`, agent-activity.css) that does not wait for the line to
 * be live (`[data-live]`). The user asked on 2026-11-24 for "a glow animated border, giving life like the dots and
 * rectangles are" on an agent's tasks, helpers and schedules lines; it may loop only while something on the line is live,
 * so nothing loops while the agent is idle.
 * Run from the repository root:
 *
 *   node scripts/perf/motion.ts [path ...]
 *
 * Each file passes or fails on its own, so one folder can pass while another still fails. Paths (files or folders)
 * limit which files are judged; keyframes are read from every file either way. Exits 1 when a judged file fails.
 *
 * How it knows a selector is set on a part of an SVG. It reads the selector's subject, the compound after the last
 * combinator, without its pseudo-elements:
 * - An SVG element name (`g`, `path`, `circle`, ...) is a part. An outer `<svg>` is a box of the page, so `svg` is not.
 * - The face (ui/src/avatar) names its drawing with classes that start with `hob-`, so a subject with such a class is
 *   a part, unless it also carries one of HTML_BOXES: the HTML boxes a face is stacked from (`avatar/Hob.tsx`).
 * - Anywhere else, a class in SVG_PARTS is a part. None is listed today: every other endless animation under ui/src
 *   is set on an HTML element or on an outer `<svg>`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const SOURCE = join(ROOT, 'ui/src')
const FACES = join(SOURCE, 'avatar')
const MOVES_ON_THE_COMPOSITOR = new Set(['transform', 'opacity'])
const SVG_ELEMENTS = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'use', 'image', 'symbol', 'marker', 'foreignobject'])
const FACE_PART = /^hob-/
const HTML_BOXES = new Set(['hob', 'hob-layer'])
const SVG_PARTS = new Set<string>()
const GLOW = /\.aa-glow(?![\w-])/
const LIVE = /\[data-live\]/
const LIVELY = /^:root\[data-motion=(['"])lively\1\]/
/** The keyframes of a rule that sets an animation's count but not its name. */
const SET_ELSEWHERE = '(set elsewhere)'
// Words of the `animation` shorthand that are never a keyframes name.
const KEYWORDS = new Set([
  'none', 'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'forwards', 'backwards', 'both',
  'running', 'paused', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'initial', 'inherit', 'unset',
])

interface Block {
  prelude: string
  line: number
  declarations: { property: string; value: string }[]
  children: Block[]
}

interface Endless {
  file: string
  line: number
  selector: string
  keyframes: string
  properties: string[]
  problems: string[]
}

function cssFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return path.endsWith('.css') ? [path] : []
  return readdirSync(path).sort().flatMap((name) => cssFiles(join(path, name)))
}

/** The style sheet as a tree of blocks. Comments become spaces, so line numbers still count. */
function parse(text: string): Block[] {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
  const top: Block = { prelude: '', line: 1, declarations: [], children: [] }
  const open: Block[] = [top]
  let pending = ''
  let pendingStart = 0
  let line = 1
  let quote: string | null = null

  const settle = (into: Block) => {
    const colon = pending.indexOf(':')
    if (colon > 0) {
      into.declarations.push({
        property: pending.slice(0, colon).trim().toLowerCase(),
        value: pending.slice(colon + 1).trim(),
      })
    }
    pending = ''
  }

  for (let index = 0; index < source.length; index++) {
    const char = source[index]!
    if (char === '\n') line++
    if (quote) {
      if (char === quote && source[index - 1] !== '\\') quote = null
      pending += char
      continue
    }
    if (char === '"' || char === "'") quote = char
    if (char === '{') {
      const block: Block = { prelude: pending.trim(), line: pendingStart, declarations: [], children: [] }
      open.at(-1)!.children.push(block)
      open.push(block)
      pending = ''
    } else if (char === '}') {
      settle(open.at(-1)!)
      if (open.length > 1) open.pop()
    } else if (char === ';') {
      settle(open.at(-1)!)
    } else {
      if (pending.trim() === '' && char.trim() !== '') pendingStart = line
      pending += char
    }
  }
  return top.children
}

/** Splits at the separator (a comma unless given) where it is not inside parentheses or brackets. */
function splitTop(text: string, separator = ','): string[] {
  const parts: string[] = []
  let depth = 0
  let part = ''
  for (const char of text) {
    if (char === '(' || char === '[') depth++
    if (char === ')' || char === ']') depth--
    if (char === separator && depth === 0) {
      parts.push(part.trim())
      part = ''
    } else part += char
  }
  if (part.trim()) parts.push(part.trim())
  return parts
}

function words(text: string): string[] {
  return splitTop(text.replace(/\s+/g, ' '), ' ')
}

const KEYFRAMES = /^@(?:-webkit-)?keyframes\s+(\S+)/

/** Visits every block with the preludes of the style rules it is nested in. A keyframes block's frames are not visited. */
function walk(blocks: Block[], visit: (block: Block, parents: string[]) => void, parents: string[] = []): void {
  for (const block of blocks) {
    visit(block, parents)
    if (KEYFRAMES.test(block.prelude)) continue
    // An at-rule (@media, @layer) wraps rules without adding to their selectors.
    const nested = block.prelude.startsWith('@') ? parents : [...parents, block.prelude]
    walk(block.children, visit, nested)
  }
}

/** Every keyframes name, with the properties its frames change. */
function keyframesOf(files: string[]): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  for (const file of files) {
    walk(parse(readFileSync(file, 'utf8')), (block) => {
      const name = KEYFRAMES.exec(block.prelude)?.[1]
      if (!name) return

      const properties = found.get(name) ?? new Set<string>()
      for (const frame of block.children) {
        for (const { property } of frame.declarations) {
          // A frame's own timing function is not something the animation changes.
          if (!property.startsWith('animation-')) properties.add(property)
        }
      }
      found.set(name, properties)
    })
  }
  return found
}

/** A nested rule's selectors, written out in full. */
function selectorsOf(prelude: string, parents: string[]): string[] {
  const nest = (outer: string, inner: string) => (inner.includes('&') ? inner.replaceAll('&', outer) : `${outer} ${inner}`)

  let selectors = splitTop(prelude)
  for (const parent of [...parents].reverse()) {
    selectors = splitTop(parent).flatMap((outer) => selectors.map((inner) => nest(outer, inner)))
  }
  return selectors
}

/** The compound after the last combinator, without pseudo-elements. */
function subjectOf(selector: string): string {
  const compounds = words(selector.replace(/\s*([>+~])\s*/g, ' ')).filter((word) => !['>', '+', '~'].includes(word))
  return (compounds.at(-1) ?? '').replace(/::[\w-]+(\(.*\))?$/, '')
}

function isSvgPart(selector: string): boolean {
  const subject = subjectOf(selector)
  const element = /^[a-zA-Z][\w-]*/.exec(subject)?.[0]?.toLowerCase()
  if (element && SVG_ELEMENTS.has(element)) return true
  const classes = [...subject.matchAll(/\.([\w-]+)/g)].map((match) => match[1]!)
  if (classes.some((name) => HTML_BOXES.has(name))) return false
  return classes.some((name) => FACE_PART.test(name) || SVG_PARTS.has(name))
}

/** The keyframes name in one animation of an `animation` shorthand: a known name, or else the word no keyword claims. */
function nameIn(tokens: string[], keyframes: Map<string, Set<string>>): string {
  const known = tokens.find((token) => keyframes.has(token))
  const unclaimed = tokens.find((token) => /^[a-zA-Z_-][\w-]*$/.test(token) && !KEYWORDS.has(token))
  return known ?? unclaimed ?? '(no name)'
}

/** The animations a rule runs forever: each one's keyframes name. */
function endlessNames(block: Block, keyframes: Map<string, Set<string>>): string[] {
  const declared = new Map(block.declarations.map(({ property, value }) => [property, value]))
  const names: string[] = []

  const shorthand = declared.get('animation')
  for (const animation of shorthand ? splitTop(shorthand) : []) {
    const tokens = words(animation.replace(/!important/, ''))
    if (tokens.includes('infinite')) names.push(nameIn(tokens, keyframes))
  }

  const counts = declared.get('animation-iteration-count')
  if (counts && /\binfinite\b/.test(counts)) {
    names.push(...splitTop(declared.get('animation-name') ?? SET_ELSEWHERE))
  }
  return names
}

/** What keeps an endless animation off the compositor, or off a face, if anything. */
function problemsOf(file: string, selector: string, name: string, changes: Set<string> | undefined): string[] {
  const problems: string[] = []
  if (!changes) problems.push(`no @keyframes ${name} under ui/src`)

  const offThread = [...(changes ?? [])].filter((property) => !MOVES_ON_THE_COMPOSITOR.has(property))
  if (offThread.length > 0) problems.push(`changes ${offThread.sort().join(', ')}`)

  if (isSvgPart(selector)) problems.push('set on a part of an SVG')
  if (file.startsWith(`${FACES}/`) && !LIVELY.test(selector)) {
    problems.push("a face loops only under Lively, :root[data-motion='lively']; otherwise it plays its mood for about two seconds and rests")
  }
  if (GLOW.test(selector) && !LIVE.test(selector)) problems.push('a line glows only while something on it is live: set it under [data-live]')
  return problems
}

/** What every animation the style sheet sets changes, all together, or undefined when it sets none known under ui/src. */
function changesSetIn(blocks: Block[], keyframes: Map<string, Set<string>>): Set<string> | undefined {
  const names = new Set<string>()
  walk(blocks, (block) => {
    for (const { property, value } of block.declarations) {
      if (property === 'animation') {
        for (const animation of splitTop(value)) names.add(nameIn(words(animation.replace(/!important/, '')), keyframes))
      }
      if (property === 'animation-name') for (const name of splitTop(value)) names.add(name)
    }
  })
  const known = [...names].filter((name) => keyframes.has(name))
  if (known.length === 0) return undefined
  return new Set(known.flatMap((name) => [...keyframes.get(name)!]))
}

function endlessIn(file: string, keyframes: Map<string, Set<string>>): Endless[] {
  const found: Endless[] = []
  const blocks = parse(readFileSync(file, 'utf8'))
  walk(blocks, (block, parents) => {
    if (block.prelude.startsWith('@')) return

    for (const name of endlessNames(block, keyframes)) {
      const setElsewhere = name === SET_ELSEWHERE
      const changes = setElsewhere ? changesSetIn(blocks, keyframes) : keyframes.get(name)
      for (const selector of selectorsOf(block.prelude, parents)) {
        found.push({
          file: relative(ROOT, file),
          line: block.line,
          selector,
          keyframes: setElsewhere ? 'any this file sets' : name,
          properties: [...(changes ?? [])].sort(),
          problems: problemsOf(file, selector, name, changes),
        })
      }
    }
  })
  return found
}

const asked = process.argv.slice(2).map((path) => resolve(ROOT, path))
const isAsked = (file: string) => asked.some((path) => file === path || file.startsWith(`${path}/`))
const everyFile = cssFiles(SOURCE)
const judged = asked.length === 0 ? everyFile : everyFile.filter(isAsked)
if (asked.length > 0 && judged.length === 0) {
  throw new Error(`No CSS file under ui/src matches ${process.argv.slice(2).join(' ')}.`)
}
const keyframes = keyframesOf(everyFile)

let failedFiles = 0
let total = 0
let failures = 0
for (const file of judged) {
  const endless = endlessIn(file, keyframes)
  if (endless.length === 0) continue
  const failed = endless.filter((animation) => animation.problems.length > 0)
  total += endless.length
  failures += failed.length
  if (failed.length > 0) failedFiles++
  console.log(`${failed.length > 0 ? 'FAIL' : 'pass'} ${relative(ROOT, file)}: ${endless.length} endless, ${failed.length} failing`)
  for (const animation of endless) {
    const verdict = animation.problems.length > 0 ? `FAIL: ${animation.problems.join('; ')}` : 'ok'
    console.log(`  :${animation.line} ${animation.selector.replace(/\s+/g, ' ')} -> ${animation.keyframes} (${animation.properties.join(', ') || '?'}) ${verdict}`)
  }
}
console.log(`${total} endless animations in ${judged.length} files, ${failures} failing in ${failedFiles} files.`)
process.exitCode = failures > 0 ? 1 : 0
