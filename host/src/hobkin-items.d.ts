/**
 * The part of hobkin's work store that files an item, typed here because hobkin ships plain JavaScript. It merges with
 * the declarations in `host/src/hobkin-work.d.ts` and `host/src/review/hobkin-review.d.ts`. Paths and signatures are those
 * of `~/Poetry/hobkin` on `main`. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/work/store.mjs' {
  /**
   * Files an item on a project, open, by its stable `key`; filed again it changes nothing. `issue` is the GitHub issue it
   * came from, which only hobkin's own issue actions name. Throws for an item with no key, title or brief, or a kind
   * hobkin does not know.
   */
  export function fileItem(
    root: string,
    slug: string,
    item: { key: string; kind: string; title: string; brief: string; issue?: { repo: string; number: number; url: string } },
    now?: number,
  ): { id: string; state: string; [key: string]: unknown }
}
