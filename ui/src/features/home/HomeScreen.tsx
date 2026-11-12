import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { useStill } from '@/features/reports/still.ts'
import { HomeWidgets, ToneDot } from './HomeWidgets.tsx'
import { SmartStack } from './SmartStack.tsx'
import { useHomeModel } from './use-home.ts'

export function HomeScreen() {
  const model = useHomeModel()
  const still = useStill()
  // An available model always supplies seven days, including when there are no runs.
  const unavailable = model.week.days.length === 0
  return (
    <div className={`${SCREEN_SCROLLER} pb-6`}>
      <div className={`${SCREEN_COLUMN} @container flex flex-col gap-6`}>
        <header className="flex flex-wrap items-center gap-4 px-1">
          <Hob mood={model.header.mood} still={still} size={56} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="break-words font-heading text-[28px] leading-tight font-semibold tracking-tight">{model.header.title}</h1>
            {model.header.line ? <p className="mt-1 break-words text-sm text-muted-foreground">{model.header.line}</p> : null}
          </div>
          {model.header.chips.length ? <ul aria-label="Home status" className="flex flex-wrap gap-2">
            {model.header.chips.map(chip => <li key={chip.label} className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-muted-foreground"><ToneDot tone={chip.tone} /><span className="break-words">{chip.label}</span></li>)}
          </ul> : null}
        </header>
        <HomeWidgets model={model} unavailable={unavailable} stack={<SmartStack cards={model.stack} unavailable={unavailable} />} />
      </div>
    </div>
  )
}
