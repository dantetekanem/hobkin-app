import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { afterFailure, failedIn } from './screen-recovery.ts'
import { useView } from './view-store.ts'

// While the app is developed, new code may be the fix: every net that shows a failure tries its screen again once a hot
// update has landed. Vite drops this listener with this copy of the file.
const afterHotUpdate = new Set<() => void>()
import.meta.hot?.on('vite:afterUpdate', () => {
  for (const tryAgain of [...afterHotUpdate]) tryAgain()
})

interface Failure {
  /** What went wrong, or null while the screen draws. */
  message: string | null
  /** The parts of the app the failure came through, innermost first. */
  where: string[]
  /** The failure is on screen. Until the net has decided, nothing is: a screen drawn afresh never flashes it. */
  shown: boolean
  /** Counts each fresh draw, so the screen under the net is mounted anew. */
  attempt: number
}

/**
 * A net under each canvas screen. A screen that fails to draw is drawn afresh by itself (`screen-recovery.ts`), so one
 * failure never leaves it dead. One that fails again at once shows this in its place, with a way to try again, and
 * the rest of the app (the chat, the menu, the other screens) goes on working.
 * `of` names the screen it is under. The agents share one screen, so moving to another agent draws it afresh.
 */
export class ScreenBoundary extends Component<{ children: ReactNode; of?: string }, Failure> {
  state: Failure = { message: null, where: [], shown: false, attempt: 0 }

  /** When this screen failed lately. */
  private failedAt: number[] = []

  static getDerivedStateFromError(error: unknown): Pick<Failure, 'message' | 'shown'> {
    return { message: error instanceof Error ? error.message : 'Unknown error', shown: false }
  }

  componentDidCatch(_error: unknown, info: ErrorInfo) {
    const next = afterFailure(this.failedAt, Date.now())
    this.failedAt = next.failedAt
    if (next.again) this.drawAfresh()
    else this.setState({ shown: true, where: failedIn(info.componentStack) })
  }

  componentDidMount() {
    afterHotUpdate.add(this.tryAgainIfFailed)
  }

  componentWillUnmount() {
    afterHotUpdate.delete(this.tryAgainIfFailed)
  }

  componentDidUpdate(previous: Readonly<{ of?: string }>) {
    if (this.state.message !== null && previous.of !== this.props.of) this.tryAgain()
  }

  private drawAfresh() {
    this.setState((failure) => ({ message: null, where: [], shown: false, attempt: failure.attempt + 1 }))
  }

  /** The user's own try, or a new screen's: it starts with a clean record. */
  private tryAgain = () => {
    this.failedAt = []
    this.drawAfresh()
  }

  private tryAgainIfFailed = () => {
    if (this.state.message !== null) this.tryAgain()
  }

  render() {
    if (this.state.message === null) return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
    if (!this.state.shown) return null
    return (
      <div className="grid h-full place-items-center p-8 pt-24">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <p className="font-heading text-[20px] font-semibold">This screen could not be drawn</p>
          <p className="font-mono text-[12px] break-words text-muted-foreground">{this.state.message}</p>
          {this.state.where.length ? <p className="font-mono text-[12px] break-words text-muted-foreground">in {this.state.where.join(' › ')}</p> : null}
          <div className="flex gap-2">
            <Button onClick={this.tryAgain}>Try again</Button>
            <Button
              variant="outline"
              onClick={() => {
                const view = useView.getState()
                view.closeReview()
                view.openScreen('work')
              }}
            >
              Back to Work
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
