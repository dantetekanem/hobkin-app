/**
 * A line of words where `backticks` mark code, as the change review writes its claims. Inline, so it can sit inside a
 * heading or a button, where a paragraph of Markdown cannot.
 */
export function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) =>
        index % 2 === 1 ? (
          <code key={index} className="rounded-md bg-surface-2 px-1 py-0.5 font-mono text-[0.86em]">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}
