import { useLookAtServers } from '@/features/integrations/live.ts'
import { HomeView } from './HomeView.tsx'
import { useHomeModel } from './use-home.ts'

export function HomeScreen() {
  const model = useHomeModel()
  // The host reads Pi's servers only when asked. Without this, the connections over Projects stay empty until the Integrations screen opens.
  useLookAtServers()
  return <HomeView model={model} />
}
