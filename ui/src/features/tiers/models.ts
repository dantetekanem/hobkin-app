import { useMemo } from 'react'
import { choicesFromPi } from '#shared/tiers/from-pi.ts'
import type { ModelChoice } from '#shared/tiers/tiers.ts'
import { useModels } from '@/lib/host/index.ts'
import { useTiers } from './store.ts'

/**
 * The models the Models window offers: the ones Pi can use now, once a host has answered, and the sample
 * ones before that, so the window can be tried without a host.
 */
export function useModelChoices(): ModelChoice[] {
  const pi = useModels()
  const sample = useTiers((state) => state.models)
  return useMemo(() => (pi.sample ? sample : choicesFromPi(pi)), [pi, sample])
}
