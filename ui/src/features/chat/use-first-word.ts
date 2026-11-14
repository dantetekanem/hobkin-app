import { useLayoutEffect } from 'react'
import { hostStore, reportShown } from '@/lib/host/client.ts'
import { createFirstWord } from './first-word.ts'

/**
 * The window's one measure of how soon a reply's first words reach it and show (`first-word.ts`). Sending starts it
 * (`chat-store.ts`), the host's state feeds it, and the conversation's rows tell it what they drew. Only numbers and
 * the run id go to the host, and only to a host that takes them.
 */
export const firstWord = createFirstWord({
  now: () => Date.now(),
  afterPaint: (then) => void requestAnimationFrame(() => then()),
  report: reportShown,
})

const unsubscribe = hostStore.subscribe((state) => firstWord.observe(state))
import.meta.hot?.dispose(unsubscribe)

/** Tells the measure a row of the conversation shows a reply's words, once React has committed them. */
export function useFirstWordShown(key: string, words: boolean): void {
  useLayoutEffect(() => {
    if (words) firstWord.drawn(key)
  }, [key, words])
}
