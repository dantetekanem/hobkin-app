import { motion, type Variants } from 'motion/react'
import { useRef } from 'react'
import { useStops } from '@/app/stops.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { Button } from '@/components/ui/button.tsx'
import { useHost, useModels } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { ConnectModels } from './ConnectModels.tsx'
import { readFirstModelsNote, useFirstModelsNote, type FirstModelsNote } from './first-models.ts'

const rise: Variants = {
  hidden: { opacity: 0, transform: 'translateY(22px) scale(0.98)' },
  shown: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.rise, opacity: tween.enter } },
}

/** What hobkin's first models were set to, in plain words: everything runs on Pi's default for the provider. */
function setSaid({ provider, lead }: Extract<FirstModelsNote, { state: 'said' }>['set']): string {
  return `hobkin, its checks and its agents now run on ${lead.name}, Pi's default for ${provider.name}. You can change that in Settings.`
}

/**
 * "Connect a model", in place of the canvas while Pi can use no model, and while a sign-in is under way.
 * Every way in is Pi's, listed by `ConnectModels`, which other pages can hold too.
 *
 * Keys: Up and Down move between its controls, Enter presses the one that has the keyboard, and Escape leads back
 * to the message input, as on every canvas screen.
 *
 * `face={false}` leaves out hobkin's face, for a page that shows its own, such as the first-run setup.
 */
export function SignInScreen({ face = true }: { face?: boolean } = {}) {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const signIn = useHost((state) => state.signIn)
  const models = useModels()
  const signingIn = signIn.status === 'signing-in' ? (models.providers.find(({ id }) => id === signIn.provider)?.name ?? signIn.provider) : null
  // A provider connected here set hobkin's first models: said in place of the list, until the person goes on.
  const note = useFirstModelsNote((state) => state)
  const said = note.state === 'said' ? note : null

  return (
    <div ref={root} className="h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-6 pt-14 pb-12">
        <motion.header variants={rise} initial="hidden" animate="shown" className="flex items-center gap-4">
          {face ? <Hob mood={said ? 'celebrating' : signingIn ? 'listening' : 'hello'} size={72} stage="var(--card)" /> : null}
          <div className="min-w-0">
            <h1 className="font-heading text-[22px] leading-tight font-semibold">{said ? "You're connected" : signingIn ? `Signing in to ${signingIn}` : 'Connect a model'}</h1>
            <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
              {said ? setSaid(said.set) : 'hobkin answers with a model Pi can reach. Pi keeps every account and key. This app never sees them.'}
            </p>
          </div>
        </motion.header>
        {said ? (
          <div>
            <Button data-stop size="lg" autoFocus onClick={readFirstModelsNote}>
              Go on
            </Button>
          </div>
        ) : (
          <ConnectModels />
        )}
      </div>
    </div>
  )
}
