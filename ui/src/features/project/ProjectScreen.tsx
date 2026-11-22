import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useWorkView } from '@/features/work/store.ts'

/**
 * One project's page, a page of Work's own opened by the project's slug (053, "A page for each project"). For now it
 * names the project and says the page is still being built; its sections come in S11.
 */
export default function ProjectScreen({ slug }: { slug: string }) {
  const { work } = useWorkView()
  const name = work?.projects.find((project) => project.slug === slug)?.name ?? slug
  return (
    <div className={SCREEN_SCROLLER}>
      <div className={`${SCREEN_COLUMN} flex flex-col gap-2 pb-20`}>
        <h1 className="px-1 font-heading text-[26px] leading-tight font-semibold tracking-[-0.025em]">{name}</h1>
        <p className="px-1 text-[13.5px] leading-relaxed text-muted-foreground">This page is being built.</p>
      </div>
    </div>
  )
}
