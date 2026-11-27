import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { ConnectModels, SigningIn } from '@/features/signin/ConnectModels.tsx'
import { runCommand, useHost, useModels } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { codexProvider } from './accounts.ts'

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const LANDED = 'translateX(-50%) translateY(0px) scale(1)'
const API_KEYS = ['apiKey'] as const

interface ConnectPanelProps {
  /** A provider connected, by the sign-in or a key. */
  onDone: () => void
  still: boolean
}

/**
 * The two ways in the setup offers: the OpenAI subscription, through Pi, and an API key. The sign-in button starts
 * Pi's own sign-in, which opens the browser, and while it runs this shows what Pi says and asks, as "Connect a model"
 * does (`004-signin`). Use an API key shows Connect a model's own keys, whose steps keep the key out of the app. A
 * provider that turns connected ends it. There is no putting it off: without an account hobkin cannot think. Pi keeps
 * the account, and the app never sees it.
 */
export function ConnectPanel({ onDone, still }: ConnectPanelProps) {
  const signIn = useHost((state) => state.signIn)
  const { providers } = useModels()
  const provider = codexProvider(providers)
  // A command the host refused, such as a second sign-in while one is under way.
  const [refused, setRefused] = useState<string | null>(null)
  const primary = useRef<HTMLButtonElement | null>(null)
  const signingIn = signIn.status === 'signing-in'
  // The keys are open from the start when Pi lists no OpenAI sign-in, since they are then the only way in.
  const [keys, setKeys] = useState(provider === null)
  const problem = signIn.status === 'signed-in' || signIn.status === 'signed-out' ? signIn.problem : undefined

  const run = (command: Promise<unknown>) => {
    setRefused(null)
    command.catch((error: unknown) => setRefused(reasonOf(error)))
  }

  // Connected now, and not when the panel opened: the sign-in went through, here or in a terminal.
  const connectedIds = providers.filter((entry) => entry.connected).map((entry) => entry.id)
  // As one string, so the effect below runs when the ids change and not on every new list of the same ones.
  const connectedKey = connectedIds.join(' ')
  const connectedAtFirst = useRef(new Set(connectedIds))
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const idsNow = connectedKey.split(' ').filter(Boolean)
    const newlyConnected = idsNow.some((id) => !connectedAtFirst.current.has(id))
    if (newlyConnected) done.current()
  }, [connectedKey])

  useEffect(() => {
    if (!signingIn) primary.current?.focus({ preventScroll: true })
  }, [signingIn])

  return (
    <motion.section
      aria-label="Connect a subscription"
      initial={{ opacity: 0, transform: still ? LANDED : 'translateX(-50%) translateY(28px) scale(0.96)' }}
      animate={{ opacity: 1, transform: LANDED, transition: { transform: spring.rise, opacity: tween.enter } }}
      exit={{ opacity: 0, transform: still ? LANDED : 'translateX(-50%) translateY(14px) scale(0.98)', transition: tween.exit }}
      className="absolute bottom-[5vh] left-1/2 z-[80] flex w-[min(520px,calc(100vw-48px))] flex-col items-center gap-3"
    >
      {problem ? (
        <p role="alert" className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-[13.5px] leading-relaxed shadow-panel">
          {problem.message}
        </p>
      ) : null}
      {refused ? (
        <p role="alert" className="rounded-xl bg-card px-3 py-1.5 text-[13px] text-destructive shadow-panel">
          {refused}
        </p>
      ) : null}

      {signingIn ? (
        <div className="tale-glassy tale-glass w-full rounded-3xl p-1">
          <SigningIn signIn={signIn} onAnswer={(prompt, value) => run(runCommand('signin.answer', { prompt, value }))} onCancel={() => run(runCommand('signin.cancel'))} />
        </div>
      ) : (
        <>
          {keys ? (
            <div className="tale-glassy tale-glass scroll-quiet max-h-[32vh] w-full overflow-y-auto rounded-3xl p-3">
              <ConnectModels routes={API_KEYS} />
            </div>
          ) : null}
          {provider ? (
            <Button ref={primary} size="lg" className="h-12 px-7 text-[15px]" onClick={() => run(runCommand('signin.start', { provider: provider.id }))}>
              {problem ? 'Try again' : 'Connect OpenAI (ChatGPT subscription)'}
            </Button>
          ) : (
            <p className="max-w-[46ch] rounded-2xl bg-card px-4 py-2.5 text-center text-[13px] leading-relaxed shadow-panel">Pi does not list the OpenAI sign-in here, so connect with an API key.</p>
          )}
          {provider ? (
            <Button variant="ghost" size="lg" className="px-3.5" aria-expanded={keys} onClick={() => setKeys((open) => !open)}>
              {keys ? 'Hide the API keys' : 'Use an API key'}
            </Button>
          ) : null}
        </>
      )}
    </motion.section>
  )
}
