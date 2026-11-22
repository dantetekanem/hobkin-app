import { ProjectPage } from './ProjectPage.tsx'

/** One project's page, a page of Work's own opened by the project's slug (053, "A page for each project"). */
export default function ProjectScreen({ slug }: { slug: string }) {
  return <ProjectPage slug={slug} />
}
