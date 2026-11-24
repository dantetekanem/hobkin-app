import { ArrowUpRight, LoaderCircle } from 'lucide-react'
import type { GitHubConnection, GitHubState } from '#shared/protocol/github.ts'
import { Button } from '@/components/ui/button.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { useSettings } from '@/features/settings/store.ts'
import { cn } from '@/lib/utils.ts'
import { ghLine } from './gh.ts'
import { serviceMark } from './marks.ts'
import { ServiceMark } from './ServiceMark.tsx'

/** How gh stands, as the card's pill. While gh is still being asked, the pill shows a spinner where its dot would be. */
const STATE: Record<GitHubConnection, { label: string; tone: string; dot: string | null }> = {
  connected: { label: 'Connected', tone: 'bg-ok/15 text-ok-fg', dot: 'bg-ok' },
  missing: { label: 'Needs gh', tone: 'bg-warn/15 text-warn-fg', dot: 'bg-warn' },
  'signed-out': { label: 'Signed out', tone: 'bg-warn/15 text-warn-fg', dot: 'bg-warn' },
  unknown: { label: 'Looking', tone: 'bg-surface-2 text-muted-foreground', dot: null },
}

/** What it takes to connect, while gh is not signed in. */
const SETUP: Record<Exclude<GitHubConnection, 'connected'>, string> = {
  missing: "gh is GitHub's command line tool. Install it with brew install gh, then run gh auth login in Terminal. hobkin never asks for a token.",
  'signed-out': 'Run gh auth login in Terminal. hobkin uses the sign-in gh keeps, and never asks for a token.',
  unknown: 'hobkin is asking gh whether it is signed in.',
}

/** A count GitHub cut short reads as at least that many. */
const countOf = (items: readonly unknown[], more: boolean) => `${items.length}${more ? '+' : ''}`

function StatePill({ connection, still }: { connection: GitHubConnection; still: boolean }) {
  const { label, tone, dot } = STATE[connection]

  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-heading text-[12px] font-medium whitespace-nowrap', tone)}>
      {dot ? (
        <span className={cn('size-1.5 rounded-full', dot)} aria-hidden="true" />
      ) : (
        <LoaderCircle className={cn('size-3.5', !still && 'svc-spin')} aria-hidden="true" />
      )}
      {label}
    </span>
  )
}

/**
 * GitHub, a full integration: it connects through the user's own gh, with the login gh already has, and has a whole
 * page in the app (024-github). The card says how gh stands and as which account, what the page holds, opens it,
 * and keeps the choice of showing GitHub in the menu.
 */
export function GitHubCard({ github, still, onOpen }: { github: GitHubState; still: boolean; onOpen: () => void }) {
  const showInMenu = useSettings((settings) => settings.showGitHubInMenu)
  const setShowInMenu = useSettings((settings) => settings.setShowGitHubInMenu)

  const { connection } = github
  const offers = [
    { label: 'To review', count: countOf(github.reviews, github.more.reviews) },
    { label: 'Your pull requests', count: countOf(github.pulls, github.more.pulls) },
    { label: 'Your issues', count: countOf(github.issues, github.more.issues) },
  ]

  return (
    <section aria-label="GitHub" className="flex flex-col gap-5 rounded-[28px] bg-background p-5">
      <header className="flex items-start gap-4">
        <ServiceMark look={serviceMark('github')} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-[22px] leading-tight font-semibold tracking-[-0.022em]">GitHub</h3>
            <StatePill connection={connection} still={still} />
            {github.sample ? <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-heading text-[12px] font-medium text-muted-foreground">Sample data</span> : null}
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{ghLine(github)}</p>
        </div>
      </header>

      {connection === 'connected' ? (
        <div className="flex flex-col gap-2.5">
          <ul aria-label="On the GitHub page" className="grid grid-cols-3 gap-2 @max-[560px]:grid-cols-1">
            {offers.map((offer) => (
              <li key={offer.label} className="flex flex-col gap-0.5 rounded-2xl bg-tone-1 px-4 py-3">
                <span className="font-heading text-[22px] leading-none font-semibold tabular-nums">{offer.count}</span>
                <span className="text-[12px] text-muted-foreground">{offer.label}</span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted-foreground">Pull requests open in Review, where a review is one click away. Issues open on github.com.</p>
        </div>
      ) : (
        <p className="max-w-[64ch] text-[13px] leading-relaxed text-muted-foreground">{SETUP[connection]}</p>
      )}
      {github.error ? <p className="rounded-2xl bg-warn/15 px-4 py-2.5 text-[13px] break-words text-warn-fg">{github.error}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button data-key-stop="" onClick={onOpen}>
          <ArrowUpRight aria-hidden="true" />
          Open GitHub
        </Button>
        <label className="flex items-center gap-3">
          <span className="font-heading text-[13px] font-medium">Show in the menu</span>
          <Switch checked={showInMenu} onCheckedChange={setShowInMenu} data-key-stop="" />
        </label>
      </div>
    </section>
  )
}
