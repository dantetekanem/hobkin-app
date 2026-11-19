import { useSettings } from '@/features/settings/store.ts'
import { characterPet, petOr, type Pet, type PetChoice } from './pets.ts'

/** What the user chose in Settings (spec 047): one of the four pets, or No Pet. */
export function usePetChoice(): PetChoice {
  return petOr(useSettings((state) => state.pet))
}

/** The pet to draw where a character is needed: the chosen pet, or Ears when No Pet is chosen. */
export function usePet(): Pet {
  return characterPet(usePetChoice())
}
