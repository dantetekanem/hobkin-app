import { create, type StoreApi, type UseBoundStore } from 'zustand'

/**
 * The project the Work page shows alone, or null for All. It lives while the window does, not across restarts. It lives
 * on globalThis, as the page's tab does, so a hot update of this file keeps the choice.
 */
interface ProjectChoice {
  slug: string | null
  choose: (slug: string | null) => void
}

const holder = globalThis as { __hobkinWorkProject?: UseBoundStore<StoreApi<ProjectChoice>> }
export const useProjectChoice = (holder.__hobkinWorkProject ??= create<ProjectChoice>()(() => ({ slug: null }) as ProjectChoice))

useProjectChoice.setState({ choose: (slug) => useProjectChoice.setState({ slug }) })
