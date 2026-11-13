import { Hob } from '@/avatar/Hob.tsx'
import type { Mood } from '@/avatar/moods.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Hero, Rise } from './Reveal.tsx'
import { type ScreenId } from './screens.ts'
import { useView } from './view-store.ts'
import { useQuestions } from '@/features/questions/store.ts'

type PlaceholderScreen = Exclude<ScreenId, 'review' | 'agent' | 'mind' | 'home' | 'settings' | 'github' | 'world'>

const COPY: Record<PlaceholderScreen, { mood: Mood; line: string; spec: string }> = {
  work: { mood: 'working', line: 'hobkin and the agents it started, live, with the queue and the finished changes.', spec: '011-work' },
  routines: { mood: 'focused', line: 'Every routine, when it runs next, and what it found last time.', spec: '010-routines' },
  reports: { mood: 'searching', line: 'What finished runs brought back.', spec: '012-reports-actions' },
  actions: { mood: 'listening', line: 'Everything waiting on you, each with its choices written out.', spec: '012-reports-actions' },
  integrations: { mood: 'hello', line: 'The services hobkin can reach, and the ones you can connect.', spec: '023-integrations' },
}

/** Stands in for a canvas screen until its spec is built. Names the spec so the gap is never a mystery. */
export function Placeholder({ screen }: { screen: PlaceholderScreen }) {
  const { mood, line, spec } = COPY[screen]
  const openReviewFor = useView((view) => view.openReviewFor)
  const raiseSample = useQuestions((state) => state.raiseSample)

  return (
    <div className="grid h-full place-items-center p-8 pt-20">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <Hero>
          <Hob mood={mood} size={112} stage="var(--card)" />
        </Hero>
        <Rise>
          <p className="text-[15px] text-muted-foreground">{line}</p>
        </Rise>
        <Rise>
          <p className="font-mono text-[12px] text-muted-foreground">_specs/{spec}</p>
        </Rise>
        {screen === 'work' ? (
          <Rise>
            <Button
              variant="outline"
              onClick={() => {
                openReviewFor('sample')
              }}
            >
              Open the sample review
            </Button>
          </Rise>
        ) : null}
        {screen === 'actions' ? (
          <Rise>
            <Button variant="outline" onClick={raiseSample}>
              Show a sample question
            </Button>
          </Rise>
        ) : null}
      </div>
    </div>
  )
}
