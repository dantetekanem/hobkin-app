import { useEffect, useState } from 'react'
import type { GraphFlow } from '#shared/review/layout.ts'
import { REVIEW_ROLES, REVIEW_ROLE_INFO, type ReviewRole, type TierId } from '#shared/tiers/tiers.ts'
import { Rise } from '@/app/Reveal.tsx'
import { shownTier, modelName } from '@/features/tiers/host-tiers.ts'
import { useModelChoices } from '@/features/tiers/models.ts'
import { useTiers } from '@/features/tiers/store.ts'
import { TierChoice } from '@/features/tiers/TiersLightbox.tsx'
import { applyTiers, readTiers } from '@/lib/host/client.ts'
import { useHasHost } from '@/lib/host/index.ts'
import type { ReviewLook } from '@/features/review/state/look.ts'
import { Choice } from './SettingsScreen.tsx'
import { useSettings } from './store.ts'

/** Said under a tier that has no model of its own, with where to give it one. */
const FOLLOWED = {
  main: 'This tier has no model of its own, so it uses the chat model. Set one in Change models.',
  background: 'This tier has no model of its own, so it uses the checks model. Set one in Change models.',
} as const

const LOOKS: readonly { value: ReviewLook; label: string }[] = [
  { value: 'graph', label: 'Graph' },
  { value: 'code', label: 'Code' },
]

const LOOK_SAYS: Record<ReviewLook, string> = {
  graph: 'The change as a story of its parts and the wires between them, in Story or Free Roam.',
  code: 'The change as a diff, file by file, with comments and questions on its lines.',
}

const FLOWS: readonly { value: GraphFlow; label: string }[] = [
  { value: 'left-to-right', label: 'Left to right' },
  { value: 'top-to-bottom', label: 'Top to bottom' },
]

const FLOW_SAYS: Record<GraphFlow, string> = {
  'left-to-right': 'Where a request enters on the left, and what it calls to its right.',
  'top-to-bottom': 'Where a request enters at the top, and what it calls below it.',
}

/** Which way a review's graph reads (spec 006): left to right, the default, or top to bottom. Kept in the window's settings. */
function FlowRow() {
  const flow = useSettings((state) => state.reviewGraphFlow)
  const setFlow = useSettings((state) => state.setReviewGraphFlow)
  return (
    <div role="group" aria-label="Review graph" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-surface px-4 py-3">
      <div className="min-w-[16rem] flex-1">
        <h3 className="text-[15px] leading-tight font-semibold tracking-tight">Review graph</h3>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{FLOW_SAYS[flow]}</p>
      </div>
      <Choice label="Review graph" value={flow} options={FLOWS} onChoose={(value) => setFlow(value)} />
      <p className="w-60 text-[12px] leading-snug text-muted-foreground">An open review turns at once, and its arrow keys with it.</p>
    </div>
  )
}

/** How a review opens (spec 071): Graph, the default, or Code. Kept in the window's settings; I moves between them inside a review. */
function LookRow() {
  const look = useSettings((state) => state.reviewView)
  const setLook = useSettings((state) => state.setReviewView)
  return (
    <div role="group" aria-label="A review opens in" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-surface px-4 py-3">
      <div className="min-w-[16rem] flex-1">
        <h3 className="text-[15px] leading-tight font-semibold tracking-tight">A review opens in</h3>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{LOOK_SAYS[look]}</p>
      </div>
      <Choice label="A review opens in" value={look} options={LOOKS} onChoose={(value) => setLook(value)} />
      <p className="w-60 text-[12px] leading-snug text-muted-foreground">In a review, I moves between the two.</p>
    </div>
  )
}

/**
 * How a review opens, Graph or Code, kept in the window (spec 071), and which way its graph reads (spec 006). Then the two tiers an AI review runs on, set here in Settings (017-model-tiers): the Reviewer, which builds the review,
 * and Quick, which checks it once. A choice is saved at once, in hobkin's own settings through the host, and the next
 * review uses it. The Models window sets the same two, beside the tiers' models.
 */
export function ReviewTile() {
  const hasHost = useHasHost()
  const review = useTiers((state) => state.review)
  const view = useTiers((state) => state)
  const models = useModelChoices()
  const [saving, setSaving] = useState<ReviewRole | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // What hobkin has now, in case nothing else has asked yet.
  useEffect(() => {
    if (!hasHost) return
    let stopped = false
    readTiers().then(
      (host) => !stopped && useTiers.getState().receiveHostTiers(host),
      () => {},
    )
    return () => {
      stopped = true
    }
  }, [hasHost])

  const choose = async (role: ReviewRole, tier: TierId) => {
    if (saving || review[role] === tier) return
    setProblem(null)
    const store = useTiers.getState()
    if (!hasHost) return store.applyTiers(store.config, { ...review, [role]: tier })
    setSaving(role)
    try {
      store.receiveHostTiers(await applyTiers({ review: { [role]: tier } }))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(null)
    }
  }

  return (
    <Rise className="col-span-6 @max-[820px]:col-span-2">
      <section aria-label="Reviews" className="flex h-full flex-col gap-3 rounded-3xl bg-background p-5">
        <header>
          <h2 className="eyebrow">Reviews</h2>
          <p className="mt-1 font-heading text-[20px] leading-tight font-semibold tracking-[-0.022em]">How a change is reviewed</p>
          <p className="mt-1 max-w-[70ch] text-[13px] text-muted-foreground">How a review opens, which way its graph reads, and the two tiers it runs on: a review uses those and no other. The next review uses what is chosen here.</p>
        </header>
        <div className="flex flex-col gap-2">
          <LookRow />
          <FlowRow />
          {REVIEW_ROLES.map((role) => {
            const info = REVIEW_ROLE_INFO[role]
            const runs = shownTier(view, review[role])
            const name = modelName(runs, models)
            return (
              <div key={role} role="group" aria-label={info.label} className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-surface px-4 py-3">
                <div className="min-w-[16rem] flex-1">
                  <h3 className="text-[15px] leading-tight font-semibold tracking-tight">{info.label}</h3>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{info.meantFor}</p>
                </div>
                <TierChoice label={`Tier for ${info.label}`} value={review[role]} onChoose={(tier) => void choose(role, tier)} />
                {/* What the chosen tier runs on. A tier with no model of its own says whose it uses, so "Max" is never taken for a model it does not have. */}
                <p className="w-60 text-[12px] leading-snug">
                  <span className="font-medium">{saving === role ? 'Saving…' : name}</span>
                  {runs.effort && saving !== role ? <span className="text-muted-foreground"> {runs.effort}</span> : null}
                  {runs.follows && saving !== role ? <span className="block text-muted-foreground">{FOLLOWED[runs.follows]}</span> : null}
                </p>
              </div>
            )
          })}
        </div>
        {problem ? (
          <p role="alert" className="text-[13px] leading-snug text-bad-fg">
            Not saved. {problem}
          </p>
        ) : null}
      </section>
    </Rise>
  )
}
