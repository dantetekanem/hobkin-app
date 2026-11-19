import assert from 'node:assert/strict'
import { test } from 'node:test'
import { colorsFitting, coloredUpTo, colorsNow, keptColors, linesReached, type Ask } from '../src/features/agent-activity/colors.ts'
import type { HighlightedText } from '../src/features/review/code/use-highlighted.ts'

/**
 * A stand-in for the highlighter's worker: it counts what it is asked, answers when told to, each line as one plain
 * token, and records what was cancelled.
 */
function highlighter() {
  const asked: { code: string; language: string | null; part: Parameters<Ask>[2]['part']; done: () => void; cancelled: boolean }[] = []
  const ask: Ask = (code, language, listener) => {
    const request = { code, language, ...listener, cancelled: false }
    asked.push(request)
    return () => {
      request.cancelled = true
    }
  }
  /** Answers a request whole, or only its first lines when `upTo` is given, and ends it. */
  const answer = (index = asked.length - 1, upTo?: number) => {
    const request = asked[index]!
    const lines = request.code.split('\n').slice(0, upTo)
    request.part({ from: 0, lines: lines.map((line) => [[line, 0]]), styles: [{ light: '#111', dark: '#eee', lightFont: 0, darkFont: 0 }] })
    request.done()
  }
  return { ask, asked, answer }
}

test('a code change colored once is drawn in its colors at once when it is shown again, without asking the highlighter again', () => {
  const shiki = highlighter()
  const colors = keptColors(shiki.ask)
  const code = 'const a = 1\nconst b = 2'

  const first = colorsNow(colors, code, 'typescript', true)
  assert.equal(first.now, null, 'seen for the first time, it is drawn plain')
  assert.equal(first.asks, true, 'and asks for its colors')
  const seen: number[] = []
  const stop = colors.color(code, 'typescript', (colored) => seen.push(colored.lines.length))
  shiki.answer()
  stop()
  assert.deepEqual(seen, [2, 2], 'its lines are colored as they arrive, then it is done')

  // The page is left and come back to: the box is drawn anew, and so is every box like it, near the view or not.
  for (const near of [true, false]) {
    const again = colorsNow(colors, code, 'typescript', near)
    assert.equal(again.now?.done, true, 'the colors kept are there on the first paint')
    assert.equal(again.now?.lines.length, 2)
    assert.equal(again.asks, false)
  }
  assert.equal(shiki.asked.length, 1, 'the highlighter was asked once in all')
})

test('a code change far from view waits for its colors, and one in or near view asks for them', () => {
  const colors = keptColors(highlighter().ask)
  assert.deepEqual(colorsNow(colors, 'let far = 1', 'typescript', false), { now: null, asks: false })
  assert.deepEqual(colorsNow(colors, 'let near = 1', 'typescript', true), { now: null, asks: true })
  assert.deepEqual(colorsNow(colors, null, 'typescript', true), { now: null, asks: false }, 'a side the file does not have asks for nothing')
})

test('what is kept is what was shown most lately, up to a bound on how much code, and only once all of it is colored', () => {
  const shiki = highlighter()
  // Room for ten characters of code.
  const colors = keptColors(shiki.ask, 10)
  const keep = (code: string, language: string | null = 'ruby') => {
    const stop = colors.color(code, language, () => {})
    shiki.answer()
    stop()
  }
  const kept = (code: string, language: string | null = 'ruby') => colors.kept(code, language) !== undefined

  keep('aaaa')
  keep('bbbb')
  assert.equal(kept('aaaa'), true, 'shown again, the first is kept longer')
  keep('cccc')
  assert.equal(kept('bbbb'), false, 'past the bound, the one shown longest ago goes')
  assert.deepEqual([kept('aaaa'), kept('cccc')], [true, true])
  assert.equal(kept('cccc', 'python'), false, 'the same code in another language is colored apart')

  keep('x'.repeat(11))
  assert.equal(kept('x'.repeat(11)), false, 'a code larger than the bound is colored but not kept')
  assert.deepEqual([kept('aaaa'), kept('cccc')], [true, true], 'and pushes nothing out')

  colors.color('one\ntwo', 'ruby', () => {})
  shiki.answer(shiki.asked.length - 1, 1)
  assert.equal(kept('one\ntwo'), false, 'one that ended before every line had its colors is not kept')
  assert.equal(colorsNow(colors, 'one\ntwo', 'ruby', true).asks, true, 'so it is asked for again')
})

test('boxes that show the same code wait on one request, and it is cancelled only when the last of them is gone', () => {
  const shiki = highlighter()
  const colors = keptColors(shiki.ask)
  const late: number[] = []
  const leaving = colors.color('same', 'go', () => {})
  const arriving = colors.color('same', 'go', (colored) => late.push(colored.lines.length))
  assert.equal(shiki.asked.length, 1, 'the page coming in shares the request of the page going out')
  leaving()
  assert.equal(shiki.asked[0]!.cancelled, false)
  shiki.answer(0)
  assert.deepEqual(late, [1, 1], 'and the one still there gets the colors')
  arriving()

  const gone = colors.color('left before its colors came', 'go', () => {})
  gone()
  assert.equal(shiki.asked[1]!.cancelled, true, 'a page left before its colors came asks for nothing more')
  assert.equal(colors.kept('left before its colors came', 'go'), undefined)
})

test('a change is colored only as far as its lines are drawn, in steps of a hundred lines, and whole once it reaches its end', () => {
  const file = Array.from({ length: 1500 }, (_, index) => `line ${index + 1}`).join('\n') + '\n'
  assert.equal(coloredUpTo(null, 12), null)
  const preview = coloredUpTo(file, 12)!
  assert.equal(preview.split('\n').length, 100)
  assert.ok(file.startsWith(`${preview}\n`))
  assert.equal(coloredUpTo(file, 100), preview, 'a few more lines drawn ask for nothing new')
  assert.equal(coloredUpTo(file, 101)!.split('\n').length, 200)
  assert.equal(coloredUpTo(file, 1500), file)
  assert.equal(coloredUpTo('short\n', 1), 'short\n')
})

test('the lines a drawn diff reaches on each side: the new side for added and unchanged lines, the old side for removed ones', () => {
  const line = (kind: 'context' | 'added' | 'removed', oldLine?: number, newLine?: number) => ({ type: 'line' as const, key: `${kind}${oldLine}${newLine}`, line: { kind, marker: ' ' as const, oldLine, newLine, text: '', words: [], emphasis: false } })
  const gap = { type: 'gap' as const, key: 'g', id: 'g', hidden: 40, above: true, below: true }
  assert.deepEqual(linesReached([]), { head: 0, base: 0 })
  assert.deepEqual(linesReached([line('context', 1, 1), line('removed', 2), line('added', undefined, 2), line('added', undefined, 3), gap, line('context', 44, 45)]), { head: 45, base: 2 })
})

test('colors that came for the first lines of a code are drawn on the longer code until its own arrive, and never on other code', () => {
  const colors = { lines: [[['line 1', 0]]], styles: [], done: true } as HighlightedText
  assert.equal(colorsFitting({ code: 'line 1', language: 'ts', colors }, 'line 1\nline 2', 'ts'), colors)
  assert.equal(colorsFitting({ code: 'line 1', language: 'ts', colors }, 'line 1', 'ts'), colors)
  assert.equal(colorsFitting({ code: 'line 1', language: 'ts', colors }, 'line 10\nline 2', 'ts'), null, 'a line cut short is other code')
  assert.equal(colorsFitting({ code: 'line 1', language: 'ts', colors }, 'line 1\nline 2', 'js'), null)
  assert.equal(colorsFitting(null, 'line 1', 'ts'), null)
})
