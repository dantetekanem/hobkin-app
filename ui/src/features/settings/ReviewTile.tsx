import { useEffect, useState } from 'react'
import { REVIEW_ROLES, REVIEW_ROLE_INFO, type ReviewRole, type TierId } from '#shared/tiers/tiers.ts'
import { Rise } from '@/app/Reveal.tsx'
import { shownTier, modelName } from '@/features/tiers/host-tiers.ts'
import { useModelChoices } from '@/features/tiers/models.ts'
import { useTiers } from '@/features/tiers/store.ts'
import { TierChoice } from '@/features/tiers/TiersLightbox.tsx'
import { applyTiers, readTiers } from '@/lib/host/client.ts'
import { useHasHost } from '@/lib/host/index.ts'

/**
 * The two tiers an AI review runs on, set here in Settings (017-model-tiers): the Reviewer, which builds the review,
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
      <section aria-label="AI reviews" className="flex h-full flex-col gap-3 rounded-3xl bg-background p-5">
        <header>
          <h2 className="eyebrow">AI reviews</h2>
          <p className="mt-1 font-heading text-[20px] leading-tight font-semibold tracking-[-0.022em]">Which tier reviews a change</p>
          <p className="mt-1 max-w-[70ch] text-[13px] text-muted-foreground">A review uses two tiers and no other. The next review uses what is chosen here.</p>
        </header>
        <div className="flex flex-col gap-2">
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
                <p className="w-52 truncate text-[12px]" title={runs.effort ? `${name}, ${runs.effort}` : name}>
                  <span className="font-medium">{saving === role ? 'Saving…' : name}</span>
                  {runs.effort && saving !== role ? <span className="text-muted-foreground"> {runs.effort}</span> : null}
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
