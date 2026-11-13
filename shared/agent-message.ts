/** Publication formatting only: callers still own redaction, authorship and permission to send. */
export interface AgentMessage {
  summary: string
  details?: string
  /** The version captured by the producing job, never the version installed at publication time. */
  version?: string | null
}

export function producerVersion(value: unknown): string | null {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(value) ? value : null
}

const html = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unhtml = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const markdown = (text: string) => html(text).replace(/[\\`*_[\]#~|]/g, '\\$&').replace(/^(\d+)\./, '$1\\.').replace(/^([-+]) /, '\\$1 ')
const unmarkdown = (text: string) => unhtml(text.replace(/\\([\\`*_[\]#~|.+-])/g, '$1'))

function summaryOf(text: string): string {
  const paragraphs = text.trim().split(/\n\s*\n/).map((paragraph) =>
    paragraph
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*TL;?DR\b\s*[:—-]?\s*/i, '')
      .replace(/\s*\n\s*/g, ' ')
      .trim(),
  )
  if (paragraphs.length > 2 || paragraphs.some((paragraph) => !paragraph) || text.length > 1200) {
    throw new Error('Agent messages need one or two short summary paragraphs (at most 1200 characters). Keep material failures and required user action in that summary; supply supporting context separately.')
  }
  return paragraphs.map(markdown).join('\n\n')
}

function render({ summary, details = '', version }: AgentMessage): string {
  const known = producerVersion(version)
  return [
    `**[made by hobkin · ${known ? `v${known}` : 'version unavailable'}]**`,
    '', summaryOf(summary), '',
    '<details>',
    '<summary>Agent extra information</summary>',
    '', `<pre>${html(details.trim())}</pre>`, '',
    '</details>',
    '', '—',
  ].join('\n')
}

/** Only our exact, canonical envelope counts as already formatted; a header alone is never trusted. */
function alreadyFormatted(text: string): AgentMessage | null {
  const match = /^\*\*\[made by hobkin · (v[^\]\n]+|version unavailable)\]\*\*\n\n([\s\S]+?)\n\n<details>\n<summary>Agent extra information<\/summary>\n\n<pre>([\s\S]*?)<\/pre>\n\n<\/details>\n\n—$/.exec(text)
  if (!match) return null
  const message = {
    version: match[1] === 'version unavailable' ? null : match[1]!.slice(1),
    summary: unmarkdown(match[2]!),
    details: unhtml(match[3]!),
  }
  try {
    return render(message) === text ? message : null
  } catch {
    return null
  }
}

/** Raw HTML and fences in context stay literal inside the one collapse. No prose is silently truncated or hidden. */
export function agentMessage(message: AgentMessage): string {
  const kept = alreadyFormatted(message.summary)
  if (kept) {
    if (producerVersion(message.version) !== producerVersion(kept.version)) {
      throw new Error('An already formatted agent message does not match the producing job version; use its recorded provenance, not a pasted header.')
    }
    if (message.details !== undefined && message.details.trim() !== kept.details) {
      throw new Error('An already formatted agent message has different extra information; rebuild it from its summary and context.')
    }
    return message.summary
  }
  return render(message)
}
