import { memo } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { ReportMarkdown } from '@/features/reports/ReportMarkdown.tsx'
import { cn } from '@/lib/utils.ts'
import { SECTION_ID } from './model.ts'
import { Block } from './parts.tsx'
import { GUIDE_PRESS_TITLE, guideButton, guideRunLine, sourcesLine, type GuideLine, type GuideRead } from './run-guide.ts'
import type { GuideControl } from './use-project.ts'

/**
 * A code project's run guide as the window draws it (_specs/068-run-guide, "In the window"): on its project page, and
 * in Try it on each of its finished changes. Every line keeps its height in every state, so nothing moves under the user.
 */

const GUIDE_TONE: Record<GuideLine['tone'], string> = { ok: 'text-ok-fg', warn: 'text-warn-fg', bad: 'text-bad-fg', quiet: 'text-muted-foreground' }

/** The last run, worded as the clock moves: "Last run 3 days ago: it worked". One line of fixed height. */
export function GuideRunLine({ read }: { read: GuideRead }) {
  const now = useNow(read.state === 'read' && read.guide.lastRun !== null, 60_000)
  const line = guideRunLine(read, now)
  return (
    <p title={line.title ?? line.text} className={cn('h-5 truncate text-[13.5px] leading-5 font-medium', GUIDE_TONE[line.tone])}>
      {line.text}
    </p>
  )
}

/** The files the guide was written from. One line of fixed height, so nothing under it moves when the guide is read. */
export function GuideSources({ read }: { read: GuideRead }) {
  const line = sourcesLine(read)
  return (
    <p title={line} className="h-[18px] truncate text-[12.5px] leading-[18px] text-muted-foreground">
      {line}
    </p>
  )
}

/**
 * The guide's one button, at one width whatever it says, with hobkin's line to the last press beside it in one clamped
 * line, so nothing moves when either changes.
 */
export function GuideButton({ read, control }: { read: GuideRead; control: GuideControl }) {
  const button = guideButton(read, control.pressing)
  const { said } = control
  return (
    <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-3">
      <p role={said?.tone === 'refused' ? 'alert' : 'status'} title={said?.text} className={cn('min-w-0 truncate text-[12.5px]', said?.tone === 'refused' ? 'text-bad-fg' : 'text-muted-foreground')}>
        {said?.text ?? ''}
      </p>
      <Button variant="outline" size="sm" data-stop="" disabled={button.disabled} focusableWhenDisabled title={GUIDE_PRESS_TITLE} onClick={control.press} className="w-[148px] shrink-0">
        {button.label}
      </Button>
    </div>
  )
}

/** The guide itself, as the report reader draws it. */
export function GuideText({ text }: { text: string }) {
  return (
    <div className="text-[14px] leading-relaxed">
      <ReportMarkdown text={text} />
    </div>
  )
}

/** The project page's Run guide section: its last run, its sources and its one button, then the guide. */
export const RunGuideBlock = memo(function RunGuideBlock({ read, control }: { read: GuideRead; control: GuideControl }) {
  const text = read.state === 'read' ? read.guide.text : null
  return (
    <Block id={SECTION_ID.runGuide} label="Run guide" aside={<GuideButton read={read} control={control} />}>
      <div className="flex flex-col gap-1 rounded-3xl bg-background px-5 py-4">
        <GuideRunLine read={read} />
        <GuideSources read={read} />
        {text ? (
          <div className="mt-3 border-t border-border/60 pt-4">
            <GuideText text={text} />
          </div>
        ) : null}
      </div>
    </Block>
  )
})
