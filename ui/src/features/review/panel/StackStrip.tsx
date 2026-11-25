import { ChevronLeft, ChevronRight, Layers } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FinishedChange } from '#shared/protocol/work.ts'
import { readOutdated, type ReviewListItem } from '#shared/review/status.ts'
import { useView } from '@/app/view-store.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { reviewBadge, type BadgeTone } from '@/features/work/review-badge.ts'
import { useWorkView } from '@/features/work/store.ts'
import { useReviewList } from '@/features/work/use-review-list.ts'
import { cn } from '@/lib/utils.ts'
import { layerPlaceOf, openKeyOf, stackStrip, type StackStrip as Strip, type StripLayer } from '../stack-strip.ts'

/** The event the review's key listener sends the strip for `{` and `}`: -1 goes to the layer under, 1 to the layer over. */
export const LAYER_EVENT = 'rv-layer'

const TONE: Record<BadgeTone, string> = {
  ok: 'bg-ok/15 text-ok-fg',
  bad: 'bg-bad/15 text-bad-fg',
  warn: 'bg-warn/15 text-warn-fg',
  quiet: 'bg-background text-muted-foreground',
}

/** A layer's review as the rest of the app shows it: its answer, being reviewed, not reviewed, or outdated. */
function stateOf(item: ReviewListItem | undefined): { tone: BadgeTone; label: string; reviewing: boolean } {
  const badge = reviewBadge(item?.assessment)
  const reviewing = item?.assessment?.state === 'running' || item?.assessment?.state === 'queued'
  if (readOutdated(item?.outdated)) return { tone: 'warn', label: 'Outdated', reviewing }
  return { tone: badge.tone, label: badge.label, reviewing }
}

/** The sample's review is every layer's review at once, so with no host the strip starts on layer 3 and a press moves its mark only. */
const sampleKey = (changes: readonly FinishedChange[]) => (changes.find((change) => change.stack?.layer === 3) ?? changes.find((change) => change.stack))?.key ?? null

/**
 * Where this review stands in its stack, between the place line and the title of the panel: "Layer 2 of 5", a step for
 * each layer with its review's state, and the layer under and over. Nothing is drawn, and no room kept, for a review
 * that is no layer of a stack.
 */
export function StackStrip({ reviewId, head, live }: { reviewId: string; head?: string | null; live: boolean }) {
  const { work } = useWorkView()
  const changes = useMemo(() => (work?.finished ?? []).flatMap((group) => group.changes), [work])
  const [picked, setPicked] = useState<string | null>(null)
  const strip = stackStrip(changes, live ? openKeyOf(changes, reviewId, head) : (picked ?? sampleKey(changes)))
  if (!strip) return null
  return <StripRow strip={strip} live={live} onSample={setPicked} />
}

function StripRow({ strip, live, onSample }: { strip: Strip; live: boolean; onSample: (key: string) => void }) {
  const list = useReviewList(live).list
  const root = useRef<HTMLDivElement>(null)
  const go = (layer: StripLayer | null) => {
    if (!layer || layer.open) return
    if (live) useView.getState().openReviewFor(layer.reviewId)
    else onSample(layer.key)
  }

  // The review's key listener, registered once, sends `{` and `}` here.
  const latest = useRef({ strip, go })
  latest.current = { strip, go }
  useEffect(() => {
    const element = root.current
    if (!element) return
    const heard = (event: Event) => {
      const { strip: now, go: goTo } = latest.current
      goTo((event as CustomEvent<number>).detail < 0 ? now.under : now.over)
    }
    element.addEventListener(LAYER_EVENT, heard)
    return () => element.removeEventListener(LAYER_EVENT, heard)
  }, [])

  const itemOf = (layer: StripLayer) => list?.reviews.find(({ id }) => id === layer.reviewId)

  return (
    <div ref={root} data-rv-layers className="mt-2 mb-1.5">
      <div className="flex h-7 items-center gap-1">
        <span className="mr-0.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-background px-2 font-heading text-[12px] font-medium whitespace-nowrap text-muted-foreground tabular-nums [&_svg]:size-3.5">
          <Layers aria-hidden="true" />
          Layer {strip.at} of {strip.of}
        </span>
        <Arrow label="The layer under" keys="{" layer={strip.under} onGo={go}>
          <ChevronLeft />
        </Arrow>
        <ol aria-label="The layers of this stack, bottom first" className="rv-scroll flex min-w-0 items-center gap-1 overflow-x-auto -my-[3px] px-[3px] py-[3px]">
          {strip.slots.map((layer, index) =>
            layer ? <Step key={layer.key} layer={layer} state={stateOf(itemOf(layer))} onGo={go} /> : <Gap key={index} number={index + 1} />,
          )}
        </ol>
        <Arrow label="The layer over" keys="}" layer={strip.over} onGo={go}>
          <ChevronRight />
        </Arrow>
      </div>
      <p className="h-[18px] truncate text-[12px] leading-[18px] text-muted-foreground" title={strip.line}>
        {strip.line}
      </p>
    </div>
  )
}

function Step({ layer, state, onGo }: { layer: StripLayer; state: ReturnType<typeof stateOf>; onGo: (layer: StripLayer) => void }) {
  return (
    <li className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-stop
              aria-current={layer.open ? 'step' : undefined}
              aria-label={`Layer ${layer.number}: ${layer.title}. ${state.label}.`}
              onClick={() => onGo(layer)}
              className={cn(
                'grid size-6 place-items-center rounded-full text-[11px] font-medium tabular-nums transition-[background-color,color,transform] duration-[160ms] ease-[var(--ease-out)] active:scale-[0.94]',
                TONE[state.tone],
                state.reviewing && 'outline-1 -outline-offset-1 outline-muted-foreground/70 outline-dashed',
                layer.open && 'font-semibold ring-2 ring-foreground/70',
              )}
            />
          }
        >
          {layer.number}
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>
          {layer.title}
          <span className="block text-[12px] opacity-70">{state.label}</span>
        </TooltipContent>
      </Tooltip>
    </li>
  )
}

/** A layer this window does not hold keeps its place in the row, so the others stay where they are. */
function Gap({ number }: { number: number }) {
  return (
    <li className="shrink-0">
      <span title={`Layer ${number} is not in this list`} aria-label={`Layer ${number} is not here`} className="grid size-6 place-items-center rounded-full text-[11px] text-muted-foreground/50 tabular-nums outline-1 -outline-offset-1 outline-muted-foreground/30 outline-dashed">
        {number}
      </span>
    </li>
  )
}

function Arrow({ label, keys, layer, onGo, children }: { label: string; keys: string; layer: StripLayer | null; onGo: (layer: StripLayer) => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-stop
            disabled={!layer}
            aria-label={layer ? `${label}: layer ${layer.number}` : `${label}: none`}
            onClick={() => layer && onGo(layer)}
            className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground transition-[background-color,color,transform] duration-[160ms] ease-[var(--ease-out)] hover:bg-secondary hover:text-foreground active:scale-[0.94] disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>
        {label} <Kbd>{keys}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/** "2 of 5", before the title of a row that lists a layer's review. Nothing for a review that is no layer. */
export function LayerPlace({ reviewId, head, at }: { reviewId: string; head?: string | null; /** The place a frame of the list gives this layer, which counts the pull requests too: it wins over hobkin's own. */ at?: string | null }) {
  const { work } = useWorkView()
  const own = useMemo(() => layerPlaceOf((work?.finished ?? []).flatMap((group) => group.changes), reviewId, head), [work, reviewId, head])
  const place = at ?? own
  if (!place) return null
  return (
    <span title="A layer of a stack, which lands after the layers under it" className="mr-2 inline-flex h-5 items-center gap-1 rounded-full bg-surface-2 px-2 align-[1px] font-heading text-[11px] font-medium whitespace-nowrap text-muted-foreground tabular-nums [&_svg]:size-3">
      <Layers aria-hidden="true" />
      {place}
    </span>
  )
}
