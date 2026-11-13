import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { runCommand, useHasHost } from '@/lib/host/index.ts'

/** How often the window asks the host whether its code is behind what is on disk. */
const ASK_EVERY_MS = 15_000

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * Says when hobkin's host is running older code than the code on disk, and restarts the host alone. The window loads
 * its own code as it changes; the host loads its code once, when it starts. A host left running after a change shows
 * new screens over old rules, which reads as a fix that did not work. Nothing shows while the two agree.
 */
export function StaleHost() {
  const live = useHasHost()
  const [code, setCode] = useState<{ startedAt: string; changed: number } | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!live) return setCode(null)
    let stopped = false
    const ask = () =>
      runCommand('host.code').then(
        (answer) => {
          if (stopped) return
          setCode(answer.changed > 0 ? answer : null)
          // A host that started after the button was pressed is the new one.
          setRestarting(false)
        },
        // An older host has no such command, and one that is restarting does not answer: asked again next time.
        () => {},
      )
    void ask()
    const timer = setInterval(() => void ask(), ASK_EVERY_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [live])

  if (!code) return null

  const restart = async () => {
    setRestarting(true)
    setProblem(null)
    try {
      await runCommand('host.restart')
    } catch (error) {
      setRestarting(false)
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div role="status" className="pointer-events-auto fixed top-3 left-1/2 z-50 flex max-w-[min(720px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 text-[13px] leading-snug shadow-panel">
      <span className="min-w-0">
        <span className="font-semibold">hobkin's host is running older code.</span> It started at {clock(code.startedAt)}, and {code.changed === 1 ? '1 file of its code has' : `${code.changed} files of its code have`} changed
        since. What you see may follow the old rules until it restarts.
        {problem ? <span className="block text-bad-fg">It did not restart: {problem}</span> : null}
      </span>
      <Button size="sm" data-stop="" disabled={restarting} title="Restarts the host alone. The window stays open. Agents and reviews that are running stop." onClick={() => void restart()} className="shrink-0">
        {restarting ? 'Restarting…' : 'Restart host'}
      </Button>
    </div>
  )
}
