import { useEffect, useRef } from 'react'
import { Kbd } from '@/components/ui/kbd.tsx'

/** The keys of the review, grouped the way a reviewer uses them. */
const GROUPS: { title: string; keys: [keys: string[], does: string][] }[] = [
  {
    title: 'The steps through the graph',
    keys: [
      [['→', 'space'], 'Next step'],
      [['←'], 'Previous step'],
      [['1 … 9', '0'], 'Step 1 to 10. Two digits make one number'],
      [['home', 'end'], 'First and last step'],
      [['B'], 'Back to the step'],
      [['G'], 'The whole graph'],
      [['P'], 'Story: from its first step, the steps leading'],
      [['O'], 'Free Roam: the whole graph, nothing leading. Every arrow moves between nodes'],
    ],
  },
  {
    title: 'The graph',
    keys: [
      [['/'], 'Find a node by name, path or kind'],
      [['L'], 'The outline: every unit and file, the folded ones too. Type to filter, ↵ to go there'],
      [['U', '⇧U'], 'The next node that needs you and is not seen, or the one before'],
      [['J', 'K'], 'The next or previous zone, on its first part that needs you'],
      [['Z'], 'Mark what you are on as seen, or take the mark off. On a group, all it holds'],
      [['↵'], 'On a group of a large change: open it in place, or close it. On a folded zone: open it'],
      [['↑', '↓'], 'The node above or below'],
      [['⇧←', '⇧→'], 'Along a wire to the left or right'],
      [['W'], 'Walk the wires of the focus'],
      [['Y', 'R'], 'Confirm or remove the open wire'],
      [[',', '.'], 'Back and forward through where you jumped'],
      [['↵'], 'Open the code of the focus, with what the change review says about it. Again to close it'],
    ],
  },
  {
    title: 'The code',
    keys: [
      [['V'], 'One column or two'],
      [['E'], 'More lines around the change'],
      [['F'], 'The whole file'],
      [['[', ']'], 'The file before or after, when the step has several'],
      [['+', '−'], 'A taller or shorter code panel'],
      [['⇧↑', '⇧↓'], 'Select lines for a note'],
      [['page up', 'page down'], 'Scroll the code'],
    ],
  },
  {
    title: 'Notes and Hobkin',
    keys: [
      [['N', 'C'], 'A comment on what you are on, in the input at the bottom'],
      [['D', 'H'], 'Ask Hobkin about what you are on, in the input at the bottom. Its chat comes into view to answer'],
      [['↵'], 'In the input: keep the comment, or send the question. ⇧↵ starts a new line'],
      [['esc'], 'In the input: back to the review, the words kept. It never stops Hobkin'],
      [['S'], 'Hide the panel, or bring it back'],
      [['{', '}'], 'In a stack: the review of the layer under this one, or of the layer over it'],
      [['⇧S'], 'On a change above 300 lines, put the keyboard on Make it a stack, beside Refresh review. Enter starts the agent'],
    ],
  },
  {
    title: 'The proof beside the review',
    keys: [
      [['T'], 'Open the proof on the first model that needs a look. Again, or esc, to close it'],
      [['⇧T'], 'Open the proof on its full page. Back comes back here as it was'],
      [['J', 'K'], 'The next and previous model of the change'],
      [['F', '⇧F'], 'The next and previous thing that failed'],
      [['1', '2', '3'], 'Run, State graph, Math'],
      [['/'], 'Search the state graph'],
      [['R'], 'Run the check again, once it ended'],
      [['↑', '↓'], 'The parts of the proof'],
    ],
  },
  {
    title: 'The verdict',
    keys: [
      [['A'], 'Approve a hobkin change: shows how its pull request opens, and how many nodes that need you are not seen. Press again within ten seconds to open it'],
      [['M'], 'Approve and merge a hobkin change: shows how it lands. Press again within ten seconds to land it'],
      [['X'], "Send the fixes to hobkin's agent, or request changes on a pull request: shows what goes. Press again within ten seconds to send it"],
    ],
  },
  {
    title: 'Leaving',
    keys: [
      [['esc'], 'One level back: the note being written, the finder, the proof, a wire, selected lines, the code, every open group at once, then the review'],
      [['⌘', '?'], 'These shortcuts'],
    ],
  },
]

/**
 * Every key of the review, on ⌘?. It sits over the graph and goes with Escape, ⌘? again, or a click outside it,
 * and gives the keyboard back to the review.
 */
export function Shortcuts({ onClose }: { onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => {
    sheet.current?.focus({ preventScroll: true })
  }, [])
  return (
    <div className="absolute inset-0 z-40 grid place-items-center p-6">
      <button type="button" aria-label="Close the shortcuts" className="absolute inset-0 cursor-default bg-background/40" onClick={onClose} />
      <div
        ref={sheet}
        role="dialog"
        aria-label="Review shortcuts"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || (event.metaKey && (event.key === '?' || event.key === '/'))) {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
        className="rv-float rv-scroll relative grid max-h-full w-full max-w-[720px] grid-cols-1 gap-x-8 gap-y-5 overflow-y-auto rounded-2xl p-5 outline-none sm:grid-cols-2"
      >
        {GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <h2 className="eyebrow">{group.title}</h2>
            <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-[12.5px]">
              {group.keys.map(([keys, does]) => (
                <div key={does} className="contents">
                  <dt className="flex gap-1 whitespace-nowrap">
                    {keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </dt>
                  <dd>{does}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  )
}
