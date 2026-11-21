/**
 * The window's endless animations (spec 052, A6). Reads every CSS file under ui/src, lists each animation that runs
 * forever (`infinite`) with its file, line, selector and the properties its keyframes change, and fails one that
 * changes anything but `transform` or `opacity`, or that is set on a part of an SVG. WebKit runs only transform and
 * opacity of an HTML box on the compositor; anything else restyles, lays out and paints on the main thread every frame.
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
const MOVES_ON_THE_COMPOSITOR = new Set(['transform', 'opacity'])
const SVG_ELEMENTS = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'use', 'image', 'symbol', 'marker', 'foreignobject'])
const FACE_PART = /^hob-/
const HTML_BOXES = new Set(['hob', 'hob-layer'])
const SVG_PARTS = new Set<string>()
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
    const at = pending.indexOf(':')
    if (at > 0) into.declarations.push({ property: pending.slice(0, at).trim().toLowerCase(), value: pending.slice(at + 1).trim() })
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

/** Splits at commas that are not inside parentheses or brackets. */
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

function walk(blocks: Block[], visit: (block: Block, parents: string[]) => void, parents: string[] = []): void {
  for (const block of blocks) {
    visit(block, parents)
    const nested = block.prelude.startsWith('@') ? parents : [...parents, block.prelude]
    if (!/^@(-webkit-)?keyframes\b/.test(block.prelude)) walk(block.children, visit, nested)
  }
}

/** Every keyframes name, with the properties its frames change. */
function keyframesOf(files: string[]): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  for (const file of files) {
    walk(parse(readFileSync(file, 'utf8')), (block) => {
      const name = /^@(?:-webkit-)?keyframes\s+(\S+)/.exec(block.prelude)?.[1]
      if (!name) return
      const properties = found.get(name) ?? new Set<string>()
      for (const frame of block.children) {
        for (const { property } of frame.declarations) if (!property.startsWith('animation-')) properties.add(property)
      }
      found.set(name, properties)
    })
  }
  return found
}

/** A nested rule's selectors, written out in full. */
function selectorsOf(prelude: string, parents: string[]): string[] {
  let selectors = splitTop(prelude)
  for (const parent of [...parents].reverse()) {
    selectors = splitTop(parent).flatMap((outer) => selectors.map((inner) => (inner.includes('&') ? inner.replaceAll('&', outer) : `${outer} ${inner}`)))
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

/** The animations a rule runs forever: each one's keyframes name. */
function endlessNames(block: Block, keyframes: Map<string, Set<string>>): string[] {
  const declared = new Map(block.declarations.map(({ property, value }) => [property, value]))
  const names: string[] = []
  const shorthand = declared.get('animation')
  if (shorthand) {
    for (const layer of splitTop(shorthand)) {
      const tokens = words(layer.replace(/!important/, ''))
      if (!tokens.includes('infinite')) continue
      const name = tokens.find((token) => keyframes.has(token)) ?? tokens.find((token) => /^[a-zA-Z_-][\w-]*$/.test(token) && !KEYWORDS.has(token))
      names.push(name ?? '(no name)')
    }
  }
  const counts = declared.get('animation-iteration-count')
  if (counts && /\binfinite\b/.test(counts)) names.push(...splitTop(declared.get('animation-name') ?? '(set elsewhere)'))
  return names
}

function endlessIn(file: string, keyframes: Map<string, Set<string>>): Endless[] {
  const found: Endless[] = []
  walk(parse(readFileSync(file, 'utf8')), (block, parents) => {
    if (block.prelude.startsWith('@')) return
    for (const name of endlessNames(block, keyframes)) {
      const changes = keyframes.get(name)
      for (const selector of selectorsOf(block.prelude, parents)) {
        const properties = changes ? [...changes].sort() : []
        const problems: string[] = []
        if (!changes) problems.push(`no @keyframes ${name} under ui/src`)
        const offThread = properties.filter((property) => !MOVES_ON_THE_COMPOSITOR.has(property))
        if (offThread.length > 0) problems.push(`changes ${offThread.join(', ')}`)
        if (isSvgPart(selector)) problems.push('set on a part of an SVG')
        found.push({ file: relative(ROOT, file), line: block.line, selector, keyframes: name, properties, problems })
      }
    }
  })
  return found
}

const asked = process.argv.slice(2).map((path) => resolve(ROOT, path))
const everyFile = cssFiles(SOURCE)
const judged = asked.length === 0 ? everyFile : everyFile.filter((file) => asked.some((path) => file === path || file.startsWith(`${path}/`)))
if (asked.length > 0 && judged.length === 0) throw new Error(`No CSS file under ui/src matches ${process.argv.slice(2).join(' ')}.`)
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
    console.log(`  :${animation.line} ${animation.selector} -> ${animation.keyframes} (${animation.properties.join(', ') || '?'}) ${verdict}`)
  }
}
console.log(`${total} endless animations in ${judged.length} files, ${failures} failing in ${failedFiles} files.`)
process.exitCode = failures > 0 ? 1 : 0
