import { useEffect, useRef, useState } from 'react'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { CodeText } from '@/features/agent-activity/CodeText.tsx'
import { CodemodeCall } from '@/features/agent-activity/CodemodeCall.tsx'
import { savedCodemode, type SavedCodemode } from '@/features/agent-activity/codemode.ts'
import { MessageText } from '@/features/chat/markdown.ts'
import { hostStore, runCommand } from '@/lib/host/client.ts'
import { useHost } from '@/lib/host/hooks.ts'
import { loadSavedRun, savedRunScope, type SavedRunState } from './saved-run.ts'

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const json = (value: unknown) => JSON.stringify(value, null, 2) ?? ''

/** The report stays open underneath; this view only reads its own saved job, never sends or resumes it. */
export function SavedRun({ report, onBack }: { report: string; onBack: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<SavedRunState>({ phase: 'loading' })
  const [origin] = useState(() => hostStore.getState())
  const home = useHost(state => state.home)
  const epoch = useHost(state => state.epoch)
  const link = useHost(state => state.link)
  const screen = useView(state => state.screen)
  const valid = home === origin.home && epoch === origin.epoch && link === 'open' && screen === 'reports'
  useEffect(() => {
    root.current?.focus({ preventScroll: true })
    return loadSavedRun(report, id => runCommand('agent.session', { report: id }), setState, savedRunScope(report, origin))
  }, [report, origin])
  const codemode = savedCodemode(state.phase === 'ready' ? state.session.entries : [])
  return (
    <div ref={root} data-saved-run tabIndex={-1} role="region" aria-label="Saved job run" className="absolute inset-0 z-10 flex flex-col bg-background outline-none" onKeyDownCapture={event => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.key === 'Tab') return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onBack() }
      if (['PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) {
        const page = root.current?.querySelector<HTMLElement>('[data-saved-scroll]')
        if (page) page.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? page.scrollHeight : page.scrollTop + page.clientHeight * (event.key === 'PageDown' ? 0.85 : -0.85)
        event.preventDefault(); event.stopPropagation()
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, a') ?? [])].filter(control => control.getClientRects().length > 0)
        const at = controls.indexOf(document.activeElement as HTMLElement)
        const next = controls[event.key === 'ArrowDown' ? Math.min(controls.length - 1, at + 1) : Math.max(0, at - 1)]
        next?.focus({ preventScroll: true }); next?.scrollIntoView({ block: 'nearest' })
        event.preventDefault(); event.stopPropagation()
      }
    }}>
      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        <Button variant="ghost" size="sm" onClick={onBack}>Back to report</Button>
      </div>
      <div data-saved-scroll className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 pb-10">
        <p className="mb-5 text-sm text-muted-foreground">Saved branch through its last complete entry · read-only · maximum 2 MiB. No session is resumed. Thinking appears only when stored. ↑/↓ walks controls; Page Up/Down reads; Esc returns.</p>
        {!valid ? <p role="alert">The connection or home changed. Return to the report and open its saved run again.</p> : state.phase === 'loading' ? <p role="status">Loading saved run…</p> : state.phase === 'error' ? <p role="alert">{state.message}</p> : <>
          <p className="mb-4 break-all text-xs text-muted-foreground">Run: {state.session.run}</p>
          {state.session.skipped > 0 ? <p role="status">The final incomplete record could not be read. Its content is unavailable.</p> : null}
          {!state.session.entries.length ? <p>No entries were stored.</p> : null}
          <ol className="flex flex-col gap-6">{state.session.entries.map((entry, index) => <li key={String(entry.id ?? index)} className="min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_120px]">
            <StoredEntry entry={entry} codemode={codemode} />
          </li>)}</ol>
        </>}
      </div>
    </div>
  )
}

function StoredEntry({ entry, codemode }: { entry: Record<string, unknown>; codemode: Map<object, SavedCodemode> }) {
  const message = object(entry.message)
  const role = String(message?.role ?? entry.type)
  const content = message?.content ?? entry.content
  const parts = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
  return <article className="flex min-w-0 flex-col gap-2">
    <h3 className="eyebrow break-all">{role}{message?.toolCallId ? ` · ${String(message.toolName ?? 'tool')} · ${String(message.toolCallId)}` : ''}</h3>
    {message && codemode.has(message) ? <CodemodeCall {...codemode.get(message)!} ended /> : null}
    {parts.map((value, index) => {
      const part = object(value)
      if (part?.type === 'text' && typeof part.text === 'string') return role === 'toolResult'
        ? <CodeText key={index} text={part.text} language={null} label="Tool output" />
        : <MessageText key={index} text={part.text} role={role === 'user' ? 'user' : 'assistant'} />
      if (part?.type === 'thinking' && typeof part.thinking === 'string') return <details key={index}><summary className="cursor-pointer text-sm text-muted-foreground">Stored thinking</summary><CodeText text={part.thinking} language={null} label="Stored thinking" /></details>
      if (part && codemode.has(part)) return <CodemodeCall key={index} {...codemode.get(part)!} ended />
      if (part?.type === 'toolCall') return <div key={index}><p className="mb-1 break-all text-sm">{String(part.name)} · {String(part.id)}</p><CodeText text={json(part.arguments)} language="json" label="Tool parameters" /></div>
      return <CodeText key={index} text={json(value)} language="json" label="Stored content block" />
    })}
    <details><summary className="cursor-pointer text-xs text-muted-foreground">All stored fields</summary><CodeText text={json(entry)} language="json" label="All stored entry fields" /></details>
  </article>
}
