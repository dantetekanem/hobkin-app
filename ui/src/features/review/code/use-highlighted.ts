import { useEffect, useState } from 'react'
import type { HighlightAnswer, HighlightRequest } from './highlight.worker.ts'
import { loadGrammar } from './languages.ts'
import type { Highlighted, HighlightedPart } from './tokens.ts'

type Listener = { part(part: HighlightedPart): void; done(): void }

let worker: Worker | null | undefined
let nextId = 1
const listeners = new Map<number, Listener>()

/** The one highlighting worker, started the first time code is shown. Null where workers cannot run. */
function highlightWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<HighlightAnswer>) => {
      const listener = listeners.get(event.data.id)
      if (!listener) return
      if ('part' in event.data) listener.part(event.data.part)
      else {
        listeners.delete(event.data.id)
        listener.done()
      }
    })
  } catch {
    worker = null
  }
  return worker
}

/** Asks for code to be highlighted. Parts arrive first lines first. The returned function cancels the request. */
export function requestHighlight(code: string, language: string | null, listener: Listener): () => void {
  const id = nextId++
  const thread = highlightWorker()
  if (thread) {
    listeners.set(id, listener)
    // The grammar is fetched here, where it can be its own small file, and handed to the worker with the code.
    void loadGrammar(language).then((grammar) => {
      if (listeners.has(id)) thread.postMessage({ id, code, language, grammar } satisfies HighlightRequest)
    })
    return () => {
      if (listeners.delete(id)) thread.postMessage({ cancel: id })
    }
  }
  // No worker: the same work on this thread, a part per task so the page still breathes.
  let live = true
  void (async () => {
    const { highlightInChunks } = await import('./highlight.ts')
    for await (const part of highlightInChunks(code, language)) {
      if (!live) return
      listener.part(part)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (live) listener.done()
  })()
  return () => {
    live = false
  }
}

export interface HighlightedText {
  /** Lines highlighted so far. A line that is not there yet is drawn plain. */
  lines: Highlighted['lines']
  styles: Highlighted['styles']
  /** True once every line has its colors. */
  done: boolean
}

const NOTHING: HighlightedText = { lines: [], styles: [], done: false }

/** Highlights text for both themes, off the main thread, and fills in as the parts arrive. */
export function useHighlighted(code: string | null, language: string | null): HighlightedText {
  const [state, setState] = useState<{ code: string | null; language: string | null; text: HighlightedText }>({ code, language, text: NOTHING })

  useEffect(() => {
    if (code == null) return
    const lines: Highlighted['lines'] = []
    return requestHighlight(code, language, {
      part: (part) => {
        for (let index = 0; index < part.lines.length; index += 1) lines[part.from + index] = part.lines[index]!
        setState({ code, language, text: { lines, styles: part.styles, done: false } })
      },
      done: () => setState((before) => (before.code === code && before.language === language ? { ...before, text: { ...before.text, done: true } } : before)),
    })
  }, [code, language])

  // Colors that belong to other text are never shown on this text.
  return state.code === code && state.language === language ? state.text : NOTHING
}
