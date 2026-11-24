import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button.tsx'
import type { YoloState } from '#shared/protocol/work.ts'
import type { Save } from './yolo-rules.ts'
import { YoloRulesSheet } from './YoloRulesSheet.tsx'

/** The setting a card's press opens in the popup: its name, the project whose own setting it is when the project sets it, and a count that makes each press new. */
export interface OpenSetting {
  name: string
  slug: string | null
  press: number
}

/** Where the popup begins, for a still of it: at a project, with a setting's save in a given state. */
export interface Start {
  open?: boolean
  scope?: string | null
  saves?: Record<string, Save>
}

/**
 * The page's Settings button and the popup it opens (063-yolo-settings-and-grades), the rules that decide whether a change
 * merges. The sentence of the rules in force is the page's, under its switch. A card's press on a holding setting opens the
 * popup at that setting. An older hobkin that sends no rules has neither button nor popup.
 */
export function YoloRules({ yolo, live, setSample, opened, start }: { yolo: YoloState; live: boolean; setSample: Dispatch<SetStateAction<YoloState>>; opened: OpenSetting | null; start?: Start }) {
  const [open, setOpen] = useState(start?.open ?? false)
  const [target, setTarget] = useState<OpenSetting | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)

  // A press on a card's holding setting opens the popup at it. Only a new press does: the host's next answer must not.
  useEffect(() => {
    if (!opened) return
    setTarget(opened)
    setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened?.press])

  if (!yolo.rules) return null
  return (
    <>
      <Button
        ref={button}
        variant="outline"
        size="sm"
        data-stop=""
        data-yolo-settings=""
        onClick={() => {
          setTarget(null)
          setOpen(true)
        }}
      >
        Settings
      </Button>
      <YoloRulesSheet open={open} yolo={yolo} live={live} setSample={setSample} target={target} onClose={() => setOpen(false)} returnTo={button} start={start} />
    </>
  )
}
