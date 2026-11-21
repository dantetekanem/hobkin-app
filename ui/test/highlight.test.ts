import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CODE_THEMES, highlightCode, highlightInChunks, languageOf, loadedLanguages, tokenStyle, type Highlighted } from '../src/features/review/code/highlight.ts'

const sample = `// One word for what the main agent is doing.
export function doingAfter(previous: string | null, event: TurnEvent): string | null {
  const part = event?.assistantMessageEvent?.type
  if (event?.type === 'tool_execution_start') return toolDoing(event.toolName, event.args)
  return previous ?? \`still \${part}\`
}
`
const textOf = (highlighted: Highlighted) => highlighted.lines.map((line) => line.map(([text]) => text).join('')).join('\n')

/** WCAG contrast of two colors given as #rrggbb. */
function contrast(a: string, b: string): number {
  const light = (hex: string) => {
    const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const [high, low] = [light(a), light(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

test('emits both themes as variables in one pass', async () => {
  const highlighted = await highlightCode(sample, 'typescript')

  // Every line of the source is there, token by token, with nothing added or lost.
  assert.equal(textOf(highlighted), sample.replace(/\n$/, ''))
  assert.equal(highlighted.lines.length, 6)
  assert.equal(highlighted.passes, 1, 'both themes come from a single run over the code')

  // Each style carries a color for the light theme and one for Dracula.
  assert.ok(highlighted.styles.length >= 5, 'a keyword, a string, a comment and a name are told apart')
  for (const style of highlighted.styles) {
    assert.match(style.light, /^#[0-9a-f]{6}$/i)
    assert.match(style.dark, /^#[0-9a-f]{6}$/i)
  }
  const styleOf = (text: string) => highlighted.styles[highlighted.lines.flat().find(([token]) => token === text)![1]]!
  assert.equal(styleOf('export').dark.toLowerCase(), '#ff79c6', "Dracula's pink for a keyword")
  assert.notEqual(styleOf('export').light.toLowerCase(), styleOf('export').dark.toLowerCase())

  // A token is drawn with both colors as CSS variables, so changing the theme recolors it with no new highlighting.
  assert.deepEqual(tokenStyle(styleOf('export')), { '--tl': styleOf('export').light, '--td': styleOf('export').dark })
  assert.equal('color' in tokenStyle(styleOf('export')), false)

  // The light theme stays readable on the cream code surface.
  for (const style of highlighted.styles) assert.ok(contrast(style.light, '#f8f4e8') >= 4.5, `${style.light} on the light code surface`)
  assert.deepEqual(CODE_THEMES, { light: 'github-light-high-contrast', dark: 'dracula' })
})

test('loads the grammar of the language shown, and no other', async () => {
  await highlightCode(sample, 'typescript')
  const loaded = loadedLanguages()

  assert.ok(loaded.includes('typescript'))
  for (const other of ['javascript', 'ruby', 'python', 'markdown', 'json', 'tsx']) assert.equal(loaded.includes(other), false, `${other} was not asked for`)

  await highlightCode("const face = 'hob'\n", 'javascript')
  assert.ok(loadedLanguages().includes('javascript'))
})

test('a language it does not know shows as plain text', async () => {
  const plain = await highlightCode('first line\n  second line\n', null)

  assert.deepEqual(plain.lines, [[['first line', 0]], [['  second line', 0]]])
  assert.deepEqual(plain.styles, [{ light: '', dark: '', lightFont: 0, darkFont: 0 }])
  assert.deepEqual(tokenStyle(plain.styles[0]!), {})

  assert.equal(languageOf('src/cli/doing.mjs'), 'javascript')
  assert.equal(languageOf('ui/src/App.tsx'), 'tsx')
  assert.equal(languageOf('shared/review/types.ts'), 'typescript')
  assert.equal(languageOf('CHANGELOG.md'), 'markdown')
  assert.equal(languageOf('assets/logo.png'), null)
  assert.equal(languageOf('Makefile'), null)
})

test('a long file comes in parts that add up to the same tokens', async () => {
  const long = Array.from({ length: 90 }, (_, index) => `export const value${index} = \`line ${index}\n  still ${index}\` // ${index}`).join('\n')
  const whole = await highlightCode(long, 'typescript')
  const parts: { from: number; lines: number }[] = []
  const lines: Highlighted['lines'] = []
  let styles: Highlighted['styles'] = []
  for await (const part of highlightInChunks(long, 'typescript', 40)) {
    parts.push({ from: part.from, lines: part.lines.length })
    lines.push(...part.lines)
    styles = part.styles
  }

  assert.deepEqual(parts, [{ from: 0, lines: 40 }, { from: 40, lines: 40 }, { from: 80, lines: 40 }, { from: 120, lines: 40 }, { from: 160, lines: 20 }])
  // The template strings run across line and part boundaries, so the grammar's state has to carry over.
  const resolved = (highlighted: { lines: Highlighted['lines']; styles: Highlighted['styles'] }) => highlighted.lines.map((line) => line.map(([text, style]) => `${text}@${highlighted.styles[style]!.dark}`))
  assert.deepEqual(resolved({ lines, styles }), resolved(whole))
})

test('a TLA+ model and its TLC config are colored, not plain', async () => {
  assert.equal(languageOf('_specs/tla/inventory/InventorySale.tla'), 'tlaplus')
  assert.equal(languageOf('_specs/tla/inventory/InventorySale.cfg'), 'tlc-config')

  const model = String.raw`---- MODULE InventorySale ----
EXTENDS Integers

\* models: app/models/inventory.rb
CONSTANTS InitialStock, Price
VARIABLES stock, outcome

(* A block
   comment *)
Init ==
    /\ stock = InitialStock
    /\ outcome = "none"

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
====`
  const tla = await highlightCode(model, 'tlaplus')
  assert.equal(textOf(tla), model)
  // The token that is exactly this text, or else the first one holding it.
  const darkOf = (highlighted: Highlighted, text: string) => {
    const tokens = highlighted.lines.flat()
    const [, style] = tokens.find(([token]) => token.trim() === text) ?? tokens.find(([token]) => token.includes(text))!
    return highlighted.styles[style]!.dark.toLowerCase()
  }
  assert.equal(darkOf(tla, 'EXTENDS'), '#ff79c6', 'a keyword')
  assert.equal(darkOf(tla, 'VARIABLES'), '#ff79c6', 'a keyword')
  assert.equal(darkOf(tla, 'Init'), '#50fa7b', 'a definition')
  assert.equal(darkOf(tla, '"none"'), '#f1fa8c', 'a string')
  assert.equal(darkOf(tla, 'models: app'), '#6272a4', 'a line comment')
  assert.equal(darkOf(tla, 'A block'), '#6272a4', 'a block comment')
  assert.equal(darkOf(tla, '/\\'), '#ff79c6', 'an operator')

  const config = String.raw`SPECIFICATION Spec
CONSTANTS InitialStock = 3
INVARIANT TypeOK
\* three units`
  const cfg = await highlightCode(config, 'tlc-config')
  assert.equal(textOf(cfg), config)
  assert.equal(darkOf(cfg, 'SPECIFICATION'), '#ff79c6', 'a section')
  assert.equal(darkOf(cfg, '3'), '#bd93f9', 'a number')
  assert.equal(darkOf(cfg, 'three units'), '#6272a4', 'a comment')
})
