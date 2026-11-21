/**
 * Counts how often an agents list is built from `runs`. Each build filters the runs once (`agentsFrom`), so this spies
 * on the runs' own `filter`. Pass the very array the snapshot holds.
 */
export function countListBuilds<Run>(runs: Run[]): { readonly count: number; reset(): void } {
  let count = 0
  const filter = runs.filter
  const counted = (...args: Parameters<typeof filter>) => {
    count += 1
    return filter.apply(runs, args)
  }
  Object.defineProperty(runs, 'filter', { value: counted })
  return {
    get count() {
      return count
    },
    reset() {
      count = 0
    },
  }
}
