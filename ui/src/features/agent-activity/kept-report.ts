import { useEffect, useRef, useState } from 'react'
import { runCommand } from '@/lib/host/index.ts'
import type { ReportFile } from './steps.ts'

/** A report teams keeps for an agent that came back in a group, as its row has it: not asked for yet, being read, read, or gone. */
export type KeptReport = { state: 'idle' | 'reading' | 'missing' } | { state: 'read'; text: string }

/**
 * Reads the report teams keeps for an agent that came back in a group (`teams.report`), the first time its row opens,
 * and only once. A reply that comes after the row is gone is let go.
 */
export function useKeptReport(file: ReportFile | undefined, wanted: boolean): KeptReport {
  const [report, setReport] = useState<KeptReport>({ state: 'idle' })
  const drawn = useRef(true)
  useEffect(() => {
    drawn.current = true
    return () => {
      drawn.current = false
    }
  }, [])

  const team = file?.team
  const name = file?.file
  const asked = report.state !== 'idle'
  useEffect(() => {
    if (!wanted || !team || !name || asked) return
    setReport({ state: 'reading' })
    void runCommand('teams.report', { team, file: name }).then(
      (found) => {
        if (drawn.current) setReport(found ? { state: 'read', text: found.text } : { state: 'missing' })
      },
      () => {
        if (drawn.current) setReport({ state: 'missing' })
      },
    )
  }, [wanted, team, name, asked])
  return report
}
