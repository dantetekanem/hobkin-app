/** The places the Work map draws, free or taken, before the free workers left are counted in one last row. */
export const MAP_PLACES = 8

/**
 * What the Work map draws for `capacity`, how many agents hobkin may run at once, with `running` of them running:
 * every running agent, then a free worker for each free place while the map has fewer than eight places, and when
 * free workers remain past that, one row that counts them (`more`). `places` is every row the map lays out.
 */
export function mapPlaces(capacity: number, running: number): { free: number; more: number; places: number } {
  const freeWorkers = Math.max(0, capacity - running)
  const free = Math.min(freeWorkers, Math.max(0, MAP_PLACES - running))
  const more = freeWorkers - free
  return { free, more, places: running + free + (more ? 1 : 0) }
}
