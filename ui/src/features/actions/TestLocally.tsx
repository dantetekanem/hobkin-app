import { useRef, useState, type KeyboardEvent } from 'react'
import { runCommand } from '@/lib/host/client.ts'
import { useViewer } from '@/features/viewer/store.ts'
import type { AnswerTo } from './items.ts'
import { localTestGuides, revisionComparison, type LocalTest } from './test-locally.ts'

/** The deploy decision is unchanged: opening or closing these instructions never answers it. */
export function TestLocally({ answerTo }: { answerTo?: AnswerTo | null }) {
  const labels = localTestGuides(answerTo)
  const [info, setInfo] = useState<LocalTest | null>(null)
  const [loading, setLoading] = useState(false)
  const request = useRef(0)
  if (!labels || answerTo?.slug !== 'rpsleague') return null
  const refresh = () => {
    const current = ++request.current
    setLoading(true)
    setInfo(null)
    void runCommand('work.local-test', { slug: 'rpsleague' }).then((result) => {
      if (current === request.current) setInfo(result)
    }).catch(() => {}).finally(() => {
      if (current === request.current) setLoading(false)
    })
  }
  return <LocalTestPanel labels={labels} info={info} loading={loading} refresh={refresh} openFile={useViewer.getState().openFile} />
}

export function LocalTestPanel({ labels, info, loading, refresh, openFile }: {
  labels: string[]; info: LocalTest | null; loading: boolean; refresh: () => void; openFile: (path: string) => void
}) {
  const close = (details: HTMLDetailsElement | null) => {
    if (!details) return
    details.open = false
    details.querySelector('summary')?.focus()
  }

  const keys = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key === 'Escape' && event.currentTarget.open) {
      close(event.currentTarget)
      event.preventDefault()
      event.stopPropagation()
    } else if (/^[1-9]$/.test(event.key) || event.key === 'Backspace' || event.key.toLowerCase() === 'r') {
      event.stopPropagation()
    }
  }

  return (
    <details
      onKeyDown={keys}
      onToggle={(event) => {
        const details = event.currentTarget
        for (const control of details.querySelectorAll('[data-local-test-stop]')) control.toggleAttribute('data-stop', details.open)
        if (details.open) refresh()
      }}
      className="rounded-2xl bg-tone-1 px-3.5 py-3 text-[14px]"
    >
      <summary data-stop="" className="cursor-pointer font-medium">Test locally (optional)</summary>
      <div className="mt-3 flex flex-col gap-2">
        {loading ? <p>Reading your local checkout…</p> : <>
          <p className="break-all">Local HEAD: {info?.head ?? 'unavailable'}<br />Checkout: {info?.dirty == null ? 'unknown' : info.dirty ? 'dirty' : 'clean'}<br />Proposed deploy tip: {info?.candidate ?? 'unavailable'}</p>
          <p>{revisionComparison(info)}</p>
        </>}
        <p>Approval checks the deploy tip again. This preview uses the last fetched refs.</p>
        {!loading && (info?.repo
          ? <p>In <code className="break-all">{info.repo}</code>, run <code>bin/local-game</code>. Open <code>http://127.0.0.1:3000/worlds</code> when Puma is listening. Stop with Ctrl-C.</p>
          : <p>Checkout unavailable. Check <code>git rev-parse HEAD</code> and <code>git status --short</code> in your RpsLeague folder before testing.</p>)}
        {labels.map((label, index) => {
          const path = info?.guides[index]
          return path ? <button key={label} type="button" data-local-test-stop="" ref={(button) => { if (button) button.toggleAttribute('data-stop', Boolean(button.closest('details')?.open)) }} onClick={() => openFile(path)} className="self-start underline underline-offset-[3px]">{label}</button> : <p key={label}>{label}: {loading ? 'loading' : 'guide unavailable'}</p>
        })}
        <p className="text-muted-foreground">Closing or skipping does not record a pass, approve or deploy anything.</p>
        <button type="button" data-local-test-stop="" onClick={refresh} className="self-start underline underline-offset-[3px]">Refresh local comparison</button>
        <button type="button" data-local-test-stop="" onClick={(event) => close(event.currentTarget.closest('details'))} className="self-start rounded-sm text-muted-foreground underline underline-offset-[3px]">Back to decision / skip testing</button>
      </div>
    </details>
  )
}
