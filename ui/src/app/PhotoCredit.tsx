import { MILKY_WAY_PHOTO } from '#shared/protocol/appearance.ts'
import { useSettings } from '@/features/settings/store.ts'

/** Credit stays with the photograph, not hidden in Settings or a tooltip. */
export function PhotoCredit() {
  const showing = useSettings(state => state.customTheme && state.background?.kind === 'photo')
  if (!showing) return null

  return (
    <aside className="photo-credit" aria-label="Background photograph credit">
      <a href={MILKY_WAY_PHOTO.source} target="_blank" rel="noreferrer">{MILKY_WAY_PHOTO.credit}</a>
      {' · '}
      <a href={MILKY_WAY_PHOTO.license} target="_blank" rel="noreferrer">CC BY 4.0</a>
      {' · darkened crop'}
    </aside>
  )
}
