import { GitPullRequest } from 'lucide-react'
import { useRef } from 'react'
import { focusCanvas } from '@/app/keys.ts'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { useStops } from '@/app/stops.ts'
import { useView } from '@/app/view-store.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { useGitHub, type GitHubState } from '@/lib/host/index.ts'

/** What the GitHub tile says about the connection, in one line. */
function connectionLine(github: GitHubState): string {
  if (github.sample) return 'Sample data. Nothing here came from GitHub.'
  switch (github.connection) {
    case 'connected':
      return `Connected through gh as @${github.login}`
    case 'signed-out':
      return 'gh is installed but not signed in. Run gh auth login in Terminal.'
    case 'missing':
      return 'gh is not installed.'
    default:
      return 'Looking for gh.'
  }
}

function count(n: number, more: boolean, one: string, many: string): string {
  return `${n}${more ? '+' : ''} ${n === 1 && !more ? one : many}`
}

/**
 * Pages: the pages of the services the user connects, and, later, the pages hobkin draws for them.
 * A page opens under Pages, the way Integrations opens under Settings. This file is the entry the frame mounts.
 */
export function PagesScreen() {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const github = useGitHub()
  const openGitHub = useView((view) => view.openGitHub)
  const listed = github.sample || github.connection === 'connected'
  // The page takes the keyboard as it arrives, on its first row, so Up and Down go on from there.
  const open = () => {
    openGitHub()
    requestAnimationFrame(focusCanvas)
  }

  return (
    <div ref={root} className="scroll-quiet h-full overflow-y-auto px-6 pt-[112px] pb-8">
      <div className="mx-auto flex max-w-[880px] flex-col gap-6">
        <div className="flex items-center gap-4">
          <Hero>
            <Hob mood="thinking" size={64} stage="var(--hb-surface)" />
          </Hero>
          <Rise>
            <h1 className="font-heading text-[22px] font-semibold tracking-[-0.022em]">Pages</h1>
            <p className="text-[15px] text-muted-foreground">Pages from the services you connect, and the ones hobkin draws for you.</p>
          </Rise>
        </div>
        <div className="grid grid-cols-2 gap-3 @max-[760px]:grid-cols-1">
          <Rise>
            <button
              type="button"
              data-stop=""
              data-opens="github"
              onClick={open}
              className="flex h-full w-full flex-col gap-3 rounded-[22px] border border-border bg-background p-5 text-left shadow-panel outline-offset-2 transition-[transform,border-color] duration-[160ms] ease-out hover:border-border-strong active:scale-[0.99]"
            >
              <span className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-surface-2">
                  <GitPullRequest className="size-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-heading text-[17px] font-semibold">GitHub</span>
                  <span className="block text-[13px] text-muted-foreground">Issues and pull requests, through your own gh</span>
                </span>
              </span>
              <span className="text-[13px] text-muted-foreground">{connectionLine(github)}</span>
              {listed ? (
                <span className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                  <span>{count(github.reviews.length, github.more.reviews, 'waits for your review', 'wait for your review')}</span>
                  <span>{count(github.pulls.length, github.more.pulls, 'pull request of yours', 'pull requests of yours')}</span>
                  <span>{count(github.issues.length, github.more.issues, 'issue', 'issues')}</span>
                </span>
              ) : null}
            </button>
          </Rise>
          <Rise>
            <div className="flex h-full flex-col justify-center gap-1 rounded-[22px] border border-dashed border-border-strong p-5 text-[13px] text-muted-foreground">
              <span className="font-heading text-[15px] font-semibold text-foreground">Pages hobkin draws</span>
              When hobkin draws a page for you, such as a plan, a chart or a comparison, it lands here.
            </div>
          </Rise>
        </div>
      </div>
    </div>
  )
}
