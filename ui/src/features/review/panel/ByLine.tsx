import type { Named, PullPeople } from './by-line.ts'

/** Someone a by-line names: a link to their profile when one is known, opened in the browser as every link in the window is. */
function Person({ person }: { person: Named }) {
  if (!person.url) return <span>{person.name}</span>
  return (
    <a href={person.url} target="_blank" rel="noopener noreferrer" data-stop="" className="underline underline-offset-2 hover:text-foreground">
      {person.name}
    </a>
  )
}

/**
 * Who a pull request is from, as the review panel and a row of AI Reviews both say it: "By" its author, or "By" the
 * agent that opened it and "for" the person who asked. Nothing when nobody is named.
 */
export function ByLineNames({ people }: { people: PullPeople | null | undefined }) {
  if (!people?.author) return null
  return (
    <>
      By <Person person={people.author} />
      {people.for ? (
        <>
          , for <Person person={people.for} />
        </>
      ) : null}
    </>
  )
}
