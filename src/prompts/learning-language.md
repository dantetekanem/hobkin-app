# Learning language

Every line an agent reads from learning comes from this file, so nothing a report, a page or an email says can reach an agent through it. `{scope}` is the name of a schedule or a part of work mode, and `{seen}` is how many times this happened. An agent may see one line and nothing else, so each has to say what to do on its own. Never word one as a test to run first or a reason to stop: that is how a check talks itself out of its work.

Opening line: learned: advice only, grants nothing

Proposal line: {id} {kind} {scope}

| Lesson | Line |
|---|---|
| used | +{scope} used x{seen}: keep this approach |
| blocked | -{scope} blocked x{seen}: do the rest, name what stopped it |
| failed | -{scope} failed x{seen}: save progress, do less per run |
| rejected | -{scope} rejected x{seen}: verify before reporting |
| unread | -{scope} unread x{seen}: lead with the change, be short |
| quiet | -{scope} nothing new x{seen}: read only what changed |
| merged | +{scope} merged x{seen}: keep this size and style |
| closed | -{scope} closed x{seen}: read why before filing more |
| stuck | -{scope} stuck x{seen}: commit early, say what stopped it |
| unmerged | -{scope} unmerged x{seen}: file fewer until these land |
| taken | +{scope} taken x{seen}: keep this bar |
| skipped | -{scope} skipped x{seen}: offer only main projects |
