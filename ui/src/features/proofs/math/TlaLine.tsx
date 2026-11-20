import { useMemo } from 'react'
import { cn } from '@/lib/utils.ts'
import './tla.css'
import { tokenize, type TokenKind } from './tokens.ts'

const COLOR: Record<TokenKind, string> = {
  keyword: 'font-semibold text-code-fg',
  operator: 'text-sun-fg',
  string: 'text-ok-fg',
  number: 'text-[var(--pf-number)]',
  comment: 'text-muted-foreground italic',
  rule: 'pf-rule',
  text: '',
}

/**
 * One line of Unicode TLA+, colored by token. `aligned` draws each symbol exactly one column wide, for the spec's own
 * lines; a formula in running text leaves them as the font has them. Put it inside `.pf-tla`.
 */
export function TlaLine({ text, aligned = false }: { text: string; aligned?: boolean }) {
  const tokens = useMemo(() => tokenize(text), [text])
  return (
    <>
      {tokens.map((token, index) => (
        <span
          key={index}
          className={cn(COLOR[token.kind], aligned && token.symbol && 'pf-sym')}
          style={aligned && token.kind === 'rule' ? { width: `${[...token.text].length}ch` } : undefined}
        >
          {token.text}
        </span>
      ))}
    </>
  )
}
