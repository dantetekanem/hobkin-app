/**
 * Markdown as it is typed: the text cut into pieces, each with the look it takes, and nothing added or dropped.
 * The prompt editor lays these pieces exactly under its input, so headings, emphasis, code and links show while
 * the words are still being written. The marks themselves stay, dimmed, because they are what is typed.
 *
 * Only the look is decided here, and only what a monospace face can show at one width: weight, slant, color and
 * shading. Pure, so the rules are tested without a window.
 */

export type LiveStyle = 'mark' | 'heading' | 'strong' | 'em' | 'strike' | 'code' | 'fence' | 'block' | 'link' | 'url' | 'quote' | 'bullet' | 'rule' | 'task'

export interface LiveSpan {
  text: string
  styles: readonly LiveStyle[]
}

const PUNCTUATION = /[!-\/:-@[-`{-~]/
const WORD = /[\p{L}\p{N}]/u
const SPACE = /\s/
const AUTOLINK = /<(https?:\/\/[^\s<>]+)>/y
const BARE_URL = /https?:\/\/[^\s<>()[\]`]+/y
const TRAILING = /[.,;:!?'"*_~]+$/

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/s
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/
const HEADING = /^( {0,3})(#{1,6})(?=\s|$)(\s*)(.*)$/s
const RULE = /^ {0,3}([-*_])(?: *\1){2,} *$/
const QUOTE = /^( {0,3}>)( ?)(.*)$/s
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])( +)(\[[ xX]\] +)?(.*)$/s

const same = (left: readonly LiveStyle[], right: readonly LiveStyle[]) => left.length === right.length && left.every((style, index) => style === right[index])

/** Adds a piece, joined to the one before when they look the same. */
function push(out: LiveSpan[], text: string, styles: readonly LiveStyle[]): void {
  if (!text) return
  const last = out.at(-1)
  if (last && same(last.styles, styles)) out[out.length - 1] = { text: last.text + text, styles }
  else out.push({ text, styles })
}

const runAt = (text: string, at: number, char: string) => {
  let length = 0
  while (text[at + length] === char) length++
  return length
}

/** Where the next run of exactly `length` of `char` starts, from `from` on, or -1. */
function runFrom(text: string, from: number, char: string, length: number): number {
  for (let at = from; at < text.length; at++) {
    if (text[at] !== char) continue
    const run = runAt(text, at, char)
    if (run === length) return at
    at += run - 1
  }
  return -1
}

/** Code spans, links, emphasis and the rest of a line, on top of the look the line already has. */
function inline(text: string, base: readonly LiveStyle[], out: LiveSpan[]): void {
  let plain = ''
  const emit = (piece: string, styles: readonly LiveStyle[]) => {
    push(out, plain, base)
    plain = ''
    push(out, piece, styles)
  }
  let at = 0
  while (at < text.length) {
    const char = text[at]!

    if (char === '\\' && PUNCTUATION.test(text[at + 1] ?? '')) {
      emit('\\', [...base, 'mark'])
      plain += text[at + 1]
      at += 2
      continue
    }

    if (char === '`') {
      const length = runAt(text, at, '`')
      const close = runFrom(text, at + length, '`', length)
      if (close !== -1) {
        emit(text.slice(at, at + length), [...base, 'code', 'mark'])
        push(out, text.slice(at + length, close), [...base, 'code'])
        push(out, text.slice(close, close + length), [...base, 'code', 'mark'])
        at = close + length
      } else {
        plain += text.slice(at, at + length)
        at += length
      }
      continue
    }

    if (char === '[' || (char === '!' && text[at + 1] === '[')) {
      const open = char === '!' ? 2 : 1
      const end = text.indexOf(']', at + open)
      const close = end !== -1 && text[end + 1] === '(' ? text.indexOf(')', end + 2) : -1
      if (close !== -1) {
        emit(text.slice(at, at + open), [...base, 'mark'])
        inline(text.slice(at + open, end), [...base, 'link'], out)
        push(out, '](', [...base, 'mark'])
        push(out, text.slice(end + 2, close), [...base, 'url'])
        push(out, ')', [...base, 'mark'])
        at = close + 1
        continue
      }
    }

    if (char === '<') {
      AUTOLINK.lastIndex = at
      const auto = AUTOLINK.exec(text)
      if (auto) {
        emit('<', [...base, 'mark'])
        push(out, auto[1]!, [...base, 'url'])
        push(out, '>', [...base, 'mark'])
        at += auto[0].length
        continue
      }
    }

    if (char === 'h' && (at === 0 || !/[\w/]/.test(text[at - 1]!))) {
      BARE_URL.lastIndex = at
      const url = BARE_URL.exec(text)?.[0].replace(TRAILING, '')
      if (url && /^https?:\/\/./.test(url)) {
        emit(url, [...base, 'link'])
        at += url.length
        continue
      }
    }

    if (char === '*' || char === '_' || char === '~') {
      const length = runAt(text, at, char)
      const fits = char === '~' ? length === 2 : length <= 3
      const after = text[at + length]
      const before = text[at - 1]
      // It opens before a word, and an underscore only at the start of one, so snake_case stays as it is.
      const opens = fits && after !== undefined && !SPACE.test(after) && !(char === '_' && before !== undefined && WORD.test(before))
      let close = -1
      for (let candidate = opens ? runFrom(text, at + length, char, length) : -1; candidate !== -1; candidate = runFrom(text, candidate + length, char, length)) {
        const next = text[candidate + length]
        if (candidate > at + length && !SPACE.test(text[candidate - 1]!) && !(char === '_' && next !== undefined && WORD.test(next))) {
          close = candidate
          break
        }
      }
      if (close !== -1) {
        const look: LiveStyle[] = char === '~' ? ['strike'] : length === 1 ? ['em'] : length === 2 ? ['strong'] : ['strong', 'em']
        emit(text.slice(at, at + length), [...base, ...look, 'mark'])
        inline(text.slice(at + length, close), [...base, ...look], out)
        push(out, text.slice(close, close + length), [...base, ...look, 'mark'])
        at = close + length
      } else {
        plain += text.slice(at, at + length)
        at += length
      }
      continue
    }

    plain += char
    at += 1
  }
  push(out, plain, base)
}

/** The typed text in pieces with their look. Joined back together, the pieces are the text. */
export function liveMarkdown(text: string): LiveSpan[] {
  const out: LiveSpan[] = []
  let fence: { char: string; length: number } | null = null

  text.split('\n').forEach((line, index) => {
    if (index > 0) push(out, '\n', [])

    if (fence) {
      const close = FENCE_CLOSE.exec(line)
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) {
        push(out, line, ['fence'])
        fence = null
      } else push(out, line, ['block'])
      return
    }

    const open = FENCE_OPEN.exec(line)
    if (open && !(open[1]![0] === '`' && open[2]!.includes('`'))) {
      fence = { char: open[1]![0]!, length: open[1]!.length }
      push(out, line, ['fence'])
      return
    }

    const heading = HEADING.exec(line)
    if (heading) {
      push(out, heading[1]!, [])
      push(out, heading[2]! + heading[3]!, ['heading', 'mark'])
      inline(heading[4]!, ['heading'], out)
      return
    }

    if (RULE.test(line)) return push(out, line, ['rule'])

    const quote = QUOTE.exec(line)
    if (quote) {
      push(out, quote[1]!, ['quote', 'mark'])
      push(out, quote[2]!, ['quote'])
      inline(quote[3]!, ['quote'], out)
      return
    }

    const item = ITEM.exec(line)
    if (item) {
      push(out, item[1]!, [])
      push(out, item[2]!, ['bullet'])
      push(out, item[3]!, [])
      if (item[4]) push(out, item[4], ['task'])
      inline(item[5]!, [], out)
      return
    }

    inline(line, [], out)
  })
  return out
}
