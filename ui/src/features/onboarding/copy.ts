import { useEffect, useState } from 'react'

/** Copies the words, then says so. A clipboard that refuses says nothing. */
export const copyText = (text: string, copied: () => void) => void navigator.clipboard?.writeText(text).then(copied, () => {})

/** How long a copy button says Copied. */
const COPIED_MS = 1600

/** Says it copied for a moment after `copy` is called, then goes back. */
export function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  return [copied, () => setCopied(true)]
}
