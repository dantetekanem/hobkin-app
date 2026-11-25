/**
 * How the chat steps back while the canvas grows over it (ChatDim.tsx). A review that has the user's attention leaves a
 * strip of the chat in view, so it dims and blurs it. A durable hobkin's split lays its page over all of the chat, so the
 * chat is not drawn under it: at a background opacity under 1 it would show through the page. The model setup replaces
 * the split, so it leaves the chat as it is, as every other screen does.
 */
export function chatBack({ reviewing, split, needsModel }: { reviewing: boolean; split: boolean; needsModel: boolean }): 'dim' | 'gone' | null {
  if (split && !needsModel) return 'gone'
  return reviewing ? 'dim' : null
}
