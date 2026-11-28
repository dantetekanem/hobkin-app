const BREATH_MS = 2000

/** Listen before a question arrives: a focused but idle draft should not hold up Ask. */
export function watchAskTyping(page: EventTarget, setTyping: (active: boolean) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let composing = false
  const events = ['input', 'compositionstart', 'compositionend', 'focusout'] as const
  const activity = (event: Event) => {
    if (event.type === 'input' && !('inputType' in event)) return // Not a text edit (e.g. a checkbox).
    if ((event.target as Element | null)?.closest?.('[data-ask-sheet]')) return
    if (event.type === 'focusout' && !composing) return
    if (event.type !== 'input') composing = event.type === 'compositionstart'
    clearTimeout(timer)
    setTyping(true)
    if (!composing) timer = setTimeout(() => setTyping(false), BREATH_MS)
  }
  const listeners = new AbortController()
  for (const event of events) page.addEventListener(event, activity, { capture: true, signal: listeners.signal })
  return () => {
    clearTimeout(timer)
    listeners.abort()
  }
}
