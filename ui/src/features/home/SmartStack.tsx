import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { Hob } from '@/avatar/Hob.tsx'
import { tween } from '@/lib/motion.ts'
import { useStill } from '@/features/reports/still.ts'
import { openTarget } from './navigate.ts'
import { ToneDot } from './HomeWidgets.tsx'
import { MANUAL_HOLD_MS, visibleCardId, type StackSelection } from './stack-selection.ts'
import type { StackCard } from './types.ts'

export function SmartStack({ cards, unavailable }: { cards: StackCard[]; unavailable: boolean }) {
  const still = useStill()
  const [selected, setSelected] = useState<StackSelection | null>(null)
  const ids = cards.map(card => card.id)
  const id = visibleCardId(ids, selected, Date.now())
  const card = cards.find(card => card.id === id)
  const index = cards.findIndex(card => card.id === id)
  const selectedExists = selected !== null && ids.includes(selected.id)

  useEffect(() => {
    if (!selected) return
    if (!selectedExists) {
      setSelected(null)
      return
    }
    const timer = setTimeout(() => setSelected(null), Math.max(0, selected.at + MANUAL_HOLD_MS - Date.now()))
    return () => clearTimeout(timer)
  }, [selected, selectedExists])

  const choose = (id: string) => setSelected({ id, at: Date.now() })
  return (
    <section aria-label="Smart stack" className="relative min-w-0 pb-4">
      {cards.length > 1 ? <>
        <div aria-hidden="true" className="absolute inset-x-7 bottom-0 h-12 rounded-b-[22px] border border-border bg-background" />
        <div aria-hidden="true" className="absolute inset-x-3.5 bottom-2 h-12 rounded-b-[22px] border border-border bg-surface" />
      </> : null}
      <div className="relative flex h-full min-h-[310px] flex-col rounded-[22px] border border-border-strong bg-surface-2 p-6 pr-14 shadow-lg">
        <motion.div key={card?.id ?? 'empty'} initial={still || selected ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={tween.fade} className="flex flex-1 flex-col gap-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
              <ToneDot tone={card?.tone ?? 'quiet'} />
              <span className="eyebrow">{card?.label ?? 'Home'}</span>
              {card ? <span className="text-xs text-muted-foreground">{card.reason}</span> : null}
            </div>
            <Hob mood={card?.mood ?? 'idle'} still={still} size={44} className="shrink-0" />
          </div>
          <h2 className="break-words font-heading text-[26px] leading-tight font-semibold tracking-tight">{card?.title ?? (unavailable ? 'Waiting for Home' : 'Nothing needs you')}</h2>
          {card?.detail ? <p className="break-words text-[14px] leading-relaxed text-muted-foreground">{card.detail}</p> : null}
          {card?.next ? <p className="break-words text-[13px] leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Next: </span>{card.next}</p> : null}
          {unavailable ? <p className="text-sm text-muted-foreground">Home will appear when hobkin connects.</p> : null}
          {card ? <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
            <button type="button" onClick={() => openTarget(card.primary.target)} className="rounded-[10px] bg-sun px-4 py-2 text-sm font-semibold text-sun-fg">{card.primary.label}</button>
            {card.secondary ? <button type="button" onClick={() => openTarget(card.secondary!.target)} className="rounded-[10px] border border-border-strong px-3.5 py-2 text-sm font-medium hover:bg-surface">{card.secondary.label}</button> : null}
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">{index + 1} of {cards.length}</span>
          </div> : null}
        </motion.div>
        {cards.length > 1 ? <div aria-label="Choose a card" className="absolute top-1/2 right-3 flex -translate-y-1/2 flex-col items-center gap-1">
          {cards.map(item => <button key={item.id} type="button" aria-label={`Show ${item.label}: ${item.title}`} aria-pressed={item.id === id} onClick={() => choose(item.id)} className="grid size-7 place-items-center rounded-full hover:bg-surface">
            <span aria-hidden="true" className={`w-1.5 rounded-full ${item.id === id ? 'h-5 bg-sun' : 'h-1.5 bg-border-strong'}`} />
          </button>)}
          <button type="button" aria-label="Next card" onClick={() => choose(cards[(index + 1) % cards.length].id)} className="mt-1 grid size-7 place-items-center rounded-full border border-border bg-surface hover:bg-background"><ChevronDown aria-hidden="true" className="size-3.5" /></button>
        </div> : null}
      </div>
    </section>
  )
}
