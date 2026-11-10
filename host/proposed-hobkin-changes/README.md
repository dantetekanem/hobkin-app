# Proposed changes to hobkin

Nothing here has been applied. The host works without these changes. Each patch removes a workaround or a
refusal in the host, and each is additive: the terminal app behaves the same with them.

They are unified diffs against `~/Poetry/hobkin` at commit `a78669a`. `git apply --check` passes for each.

## 01-panes-option.patch

`HobkinApplication.open` takes a `panes` option. Left out, hobkin decides as it does today, from the
environment. A front end that is not a terminal in Herdr passes `panes: null`.

Why: hobkin gives its work director Herdr panes whenever the process runs inside Herdr, and at opening it
closes panes left over in the Work Mode tabs (`src/cli/application.mjs:229-236`). A host started from a Herdr
terminal on a development home would do that to the panes of the real terminal app. Today the host deletes
`HERDR_ENV` from its own environment before it opens hobkin (`host/src/owner.ts`). With this option it would
say what it means instead.

## 02-filed-question-details.patch

When hobkin asks a question that a routine, work mode or another session filed, it passes on only the words
and the choices (`src/cli/application.mjs:924-925`). This adds `filed: { id, from, tldr, why, recommended }`
to the request.

Why: the client's question sheet shows who asks, the short form, the recommended choice and its reason. Today
the host finds the decision again by its words (`host/src/owner.ts`, `filedQuestion`), which cannot tell two
open questions with the same words apart. The terminal dashboard ignores the extra field.

## 03-work-agents-take-messages.patch

A work agent that runs outside a pane takes messages while it works, the way a running check already does:
the director opens an inbox for the run in the runner and hands the harness `onReady`, so `message_check`
reaches it by its schedule (`work.<project>.<lane>`, one run at a time), and Pi gets the words as a steer.
The runner closes the inbox when the run ends, as it does for checks. A run in a pane is left as it is.

Why: the client lets the user talk to an agent while it works (`agent.say`, 011-work A14). The host passes the
words through hobkin's own `runner.messageCheck`, which today reaches only the checks the runner starts
(`src/cli/runner.mjs:277-315`); work runs are started without an inbox (`src/cli/work/director.mjs:861-871`).
Without this change the host refuses a message to a work agent and says hobkin cannot pass it on. It also
lets the main agent message a work agent with its `message_check` tool, which it cannot do today.
