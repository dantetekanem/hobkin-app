import { Check, Copy } from 'lucide-react'
import { createElement, isValidElement, useEffect, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react'

/**
 * A fenced block with a Copy button at its top. A fence whose info string is `copy` is a draft to send elsewhere
 * (an email, a message): it draws as readable text. Any other fence draws as code. This file has no JSX so the tests
 * can render it with Node alone.
 */

/** How long the button says it copied. */
const COPIED_MS = 1600

/** The text under a node, through the spans that mark what just arrived in a reply being written. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : ''
}

/** What a fence holds: whether it is a `copy` block, and its raw text without the newline that closes it. */
export function fenceOf(child: ReactNode): { copy: boolean; text: string } {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return { copy: false, text: '' }
  const { className = '', children } = child.props
  return { copy: /(^|\s)language-copy(\s|$)/.test(className), text: textOf(children).replace(/\n$/, '') }
}

/** The button: its icon swaps and its size stays. It copies the text as it is when pressed, so a block still arriving copies what has come. */
function CopyButton({ text }: { text: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  return createElement(
    'button',
    {
      type: 'button',
      'aria-label': copied ? 'Copied' : 'Copy',
      title: copied ? 'Copied' : 'Copy',
      onClick: () => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {}),
      className:
        'grid size-6 place-items-center rounded-full text-muted-foreground outline-offset-1 transition-[transform,background-color,color] duration-[140ms] ease-out hover:bg-surface-2 hover:text-foreground active:scale-[0.97]',
    },
    createElement(copied ? Check : Copy, { className: 'size-3.5', 'aria-hidden': true }),
  )
}

const BOX = 'mb-3 rounded-xl last:mb-0'
const HEADER = 'flex h-7 items-center justify-end pr-1 pt-1'

/** The `pre` of Markdown: a `copy` fence as text in a quiet box, any other fence as code, each with the Copy button above its text. */
export function Fence({ node: _node, children, className, ...props }: ComponentProps<'pre'> & { node?: unknown }): ReactElement {
  const { copy, text } = fenceOf(Array.isArray(children) ? children[0] : children)
  if (copy) {
    return createElement(
      'div',
      { className: `${BOX} bg-surface-2 text-[14px] leading-[1.6]` },
      createElement('div', { className: HEADER }, createElement(CopyButton, { text })),
      createElement('div', { className: 'px-3 pb-3 whitespace-pre-wrap break-words' }, text),
    )
  }
  return createElement(
    'div',
    { className: `${BOX} bg-code-bg text-code-text` },
    createElement('div', { className: HEADER }, createElement(CopyButton, { text })),
    createElement(
      'pre',
      {
        ...props,
        className: 'overflow-x-auto px-3 pb-3 font-mono text-[13px] leading-[1.7] [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[13px]',
      },
      children,
    ),
  )
}
