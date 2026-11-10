import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { useView } from './view-store.ts'

/**
 * A net under each canvas screen. A screen that fails to load or to draw shows this in its place,
 * and the rest of the app (the chat, the menu, the other screens) goes on working.
 */
export class ScreenBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state: { message: string | null } = { message: null }

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : 'Unknown error' }
  }

  render() {
    if (this.state.message === null) return this.props.children
    return (
      <div className="grid h-full place-items-center p-8 pt-24">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <p className="font-heading text-[20px] font-semibold">This screen could not be drawn</p>
          <p className="font-mono text-[12px] break-words text-muted-foreground">{this.state.message}</p>
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
    )
  }
}
