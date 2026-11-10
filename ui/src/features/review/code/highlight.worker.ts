/**
 * Highlighting off the main thread, so a long file never makes the panel or the graph stutter.
 * The page sends the grammar with the code, so this worker never fetches one and stays a single small file.
 * A file is answered in parts, first lines first.
 */
import type { LanguageRegistration } from 'shiki/core'
import { highlightWith } from './highlight-core.ts'
import type { HighlightedPart } from './tokens.ts'

export interface HighlightRequest {
  id: number
  code: string
  language: string | null
  grammar: LanguageRegistration[] | null
}

export type HighlightAnswer = { id: number; part: HighlightedPart } | { id: number; done: true } | { id: number; failed: string }

const cancelled = new Set<number>()
/** Lets a newer request, or a cancel, be read between two parts. */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0))
const answer = (message: HighlightAnswer) => postMessage(message)

addEventListener('message', async (event: MessageEvent<HighlightRequest | { cancel: number }>) => {
  if ('cancel' in event.data) {
    cancelled.add(event.data.cancel)
    return
  }
  const { id, code, language, grammar } = event.data
  try {
    for await (const part of highlightWith(code, language, grammar)) {
      if (cancelled.delete(id)) return
      answer({ id, part })
      await breathe()
    }
    answer({ id, done: true })
  } catch (error) {
    answer({ id, failed: error instanceof Error ? error.message : String(error) })
  }
})
