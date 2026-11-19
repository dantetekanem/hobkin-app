import { useSettings } from '@/features/settings/store.ts'
import { petOr, type Pet } from './pets.ts'

/** The pet the user chose in Settings (spec 047). Every drawing of hobkin follows it. */
export function usePet(): Pet {
  return petOr(useSettings((state) => state.pet))
}
