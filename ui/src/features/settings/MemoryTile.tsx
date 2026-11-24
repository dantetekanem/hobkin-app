import { Button } from '@/components/ui/button.tsx'
import { useView } from '@/app/view-store.ts'
import { Tile } from './SettingsScreen.tsx'

/** The way into Memory, a page of its own under Settings (`057-shared-memory`). */
export function MemoryTile() {
  const togglePage = useView((view) => view.togglePage)
  return (
    <Tile name="Memory" value="What hobkin remembers" className="col-span-6 @max-[820px]:col-span-2">
      <div className="flex flex-1 items-center justify-between gap-4 @max-[820px]:flex-col @max-[820px]:items-start">
        <p className="max-w-[60ch] text-[13px] text-muted-foreground">
          About you and your life, how you like things done, dates, decisions, projects and where things are. Every agent hobkin runs knows them. See where each came from, and add, correct or forget.
        </p>
        <Button variant="outline" className="shrink-0" data-stop="" data-opens="memory" onClick={() => togglePage('memory')}>
          Open memory
        </Button>
      </div>
    </Tile>
  )
}
