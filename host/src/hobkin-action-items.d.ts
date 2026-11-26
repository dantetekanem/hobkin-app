/**
 * hobkin's own Action Items list and dismissal, typed here because hobkin ships plain JavaScript. Paths and signatures
 * are those of `packages/hobkin` on `main`. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/pending-read.mjs' {
  /** One card as hobkin's hobkin_action_items tool lists it: its stable id, its group and its title. */
  export interface ListedActionItem {
    id: string
    group: 'to_do' | 'question' | 'project' | 'learning'
    title: string
  }

  /** The Action Items the user sees, less the dismissed ones. */
  export function listActionItems(root: string): { items: ListedActionItem[]; total: number }

  /**
   * Dismisses the listed cards it is given, as hobkin's tool does at the user's request: they leave Action Items and every count
   * without being answered. An id that is not listed now is passed over. Throws for a selector that names nothing.
   */
  export function dismissActionItems(
    root: string,
    selector: { id: string } | { ids: string[] } | { all: true },
    options?: { now?: number },
  ): { dismissed: number; remaining: number }
}
