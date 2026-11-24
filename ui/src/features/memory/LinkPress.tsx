import type { ReactNode } from 'react'

/**
 * A press that reads as a link inside a line of words, on the Memory page and on a chat line about a memory: its
 * underline says it can be pressed, and on hover only the underline darkens.
 */
export function LinkPress({ children, onPress, label }: { children: ReactNode; onPress: () => void; label?: string }) {
  return (
    <button
      type="button"
      data-key-stop=""
      aria-label={label}
      onClick={onPress}
      className="rounded-sm font-medium text-foreground underline decoration-border-strong underline-offset-[3px] transition-[text-decoration-color] duration-[160ms] ease-[ease] outline-offset-2 hover:decoration-foreground"
    >
      {children}
    </button>
  )
}
