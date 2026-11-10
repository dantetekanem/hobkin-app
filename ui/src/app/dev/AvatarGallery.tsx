import { useRef, useState } from 'react'
import { Hob, useHobReactions } from '@/avatar/Hob.tsx'
import { MOODS, type Mood } from '@/avatar/moods.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { cn } from '@/lib/utils.ts'
import { originOf, toggleTheme } from '../theme.ts'

/** Development page at `#/dev/avatar`: every mood, the eye follow and the pointer reactions. */
export function AvatarGallery() {
  const area = useRef<HTMLDivElement | null>(null)
  const [selected, setSelected] = useState<Mood>('idle')
  const [still, setStill] = useState(false)
  const reactions = useHobReactions(selected, { lasting: selected === 'sleepy', onWake: () => setSelected('idle') })

  return (
    <div ref={area} className="scroll-quiet h-full overflow-y-auto bg-background p-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex items-center justify-between">
          <h1 className="text-[24px] font-semibold">Avatar</h1>
          <div className="flex gap-2 text-[13px]">
            <button type="button" className="rounded-full border border-border px-3 py-1" onClick={() => setStill((value) => !value)}>
              {still ? 'Animate' : 'Hold still'}
            </button>
            <button type="button" className="rounded-full border border-border px-3 py-1" onClick={(event) => toggleTheme(originOf(event.currentTarget))}>
              Toggle theme
            </button>
            <a className="rounded-full border border-border px-3 py-1" href="#/">
              Back to the app
            </a>
          </div>
        </header>

        <section className="flex items-center gap-6 rounded-3xl border border-border bg-card p-6">
          <button type="button" aria-label="hobkin" className="cursor-default rounded-full" {...reactions.handlers}>
            <Hob mood={reactions.mood} size={160} stage="var(--card)" still={still} followWithin={area} />
          </button>
          <div className="text-[14px] text-muted-foreground">
            <p className="font-label text-[18px] font-semibold text-foreground">{reactions.mood}</p>
            <p>Move the pointer: the eyes follow. Click to poke. Brush across it five times to make it dizzy.</p>
            <p>Select sleepy below, then click the avatar to wake it.</p>
          </div>
          <div className="ml-auto flex items-end gap-2">
            {[262, 200, 86, 20, 320].map((hue) => (
              <AgentHood key={hue} hue={hue} size={36} />
            ))}
          </div>
        </section>

        <section className="grid grid-cols-6 gap-3">
          {MOODS.map((mood) => (
            <button
              key={mood}
              type="button"
              data-mood-card={mood}
              onClick={() => setSelected(mood)}
              className={cn(
                'flex flex-col items-center gap-2 rounded-2xl border bg-card p-3 text-[12px]',
                mood === selected ? 'border-ring' : 'border-border',
              )}
            >
              <Hob mood={mood} size={96} stage="var(--card)" still={still} />
              <span className="font-label font-medium">{mood}</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  )
}
