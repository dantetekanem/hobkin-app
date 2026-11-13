import { ABOUT } from '@/app/about.ts'
import { runCommand } from '@/lib/host/client.ts'

/** A link that opens in the Mac's browser through the host. */
function Link({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      data-stop=""
      onClick={(event) => {
        event.preventDefault()
        void runCommand('system.open', { url: href }).catch(() => {})
      }}
      className="rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </a>
  )
}

/** The foot of Settings: the version, who made hobkin and where it lives. */
export function AboutLine() {
  return (
    <p className="mx-auto mt-6 flex flex-wrap justify-center gap-x-3 text-[12px] text-muted-foreground">
      <span>{ABOUT.name} {ABOUT.version}</span>
      <span>Created by <Link href={ABOUT.authorAddress}>{ABOUT.author}</Link></span>
      <Link href={ABOUT.address}>{ABOUT.address.replace('https://', '')}</Link>
    </p>
  )
}
