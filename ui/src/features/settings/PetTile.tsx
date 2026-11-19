import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Hob } from '@/avatar/Hob.tsx'
import { PETS, PET_LABEL, type Pet } from '@/avatar/pets.ts'
import { usePet } from '@/avatar/use-pet.ts'
import { play } from '@/features/sound/index.ts'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { Tile } from './SettingsScreen.tsx'
import { useSettings } from './store.ts'

/**
 * The pet hobkin is drawn as (spec 047). The four pets are the choice. The one picked cheers, and every hobkin in the
 * window changes with it. Left and Right move between them, as in any radio group.
 */
export function PetTile() {
  const pet = usePet()
  const setPet = useSettings((state) => state.setPet)
  const [cheering, setCheering] = useState<Pet | null>(null)
  useEffect(() => {
    if (!cheering) return
    const done = setTimeout(() => setCheering(null), 1600)
    return () => clearTimeout(done)
  }, [cheering])

  const choose = (next: Pet) => {
    if (next === pet) return
    setPet(next)
    setCheering(next)
    play('cheer')
  }

  return (
    <Tile name="Pet" value={PET_LABEL[pet]} className="col-span-6 @max-[820px]:col-span-2">
      <div
        role="radiogroup"
        aria-label="Pet"
        className="grid grid-cols-4 gap-2 @max-[820px]:grid-cols-2"
        onKeyDown={(event) => {
          const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (!delta) return
          const next = PETS[(PETS.indexOf(pet) + delta + PETS.length) % PETS.length]!
          event.currentTarget.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus()
          choose(next)
          event.preventDefault()
        }}
      >
        {PETS.map((option) => {
          const selected = option === pet
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={PET_LABEL[option]}
              data-value={option}
              // The chosen one is this group's stop in the walk.
              data-stop={selected ? '' : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => choose(option)}
              className={cn(
                'relative flex flex-col items-center gap-1 rounded-2xl pt-3 pb-2 outline-offset-0',
                'transition-colors duration-[160ms] ease-[ease]',
                selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {selected ? <motion.span layoutId="choice-pet" className="absolute inset-0 rounded-2xl bg-tone-1" transition={spring.pill} /> : null}
              <Hob pet={option} mood={cheering === option ? 'happy' : 'idle'} size={92} still={!selected} title={PET_LABEL[option]} className="relative" />
              <span className="relative text-[13px] font-medium">{PET_LABEL[option]}</span>
            </button>
          )
        })}
      </div>
    </Tile>
  )
}
