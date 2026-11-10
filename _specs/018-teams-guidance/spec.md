---
{
  "id": "018-teams-guidance",
  "title": "hobkin's own teams and team-leader guidance",
  "kind": "work",
  "status": "draft",
  "depends": ["017-model-tiers"],
  "updated": "2026-11-09"
}
---
# hobkin's own teams and team-leader guidance

## Outcome

hobkin leads the way a good team lead does. It keeps the outcome, splits substantial work into independent lanes, picks a tier for each lane, hands each agent the context it needs, and accepts work on evidence. The rules come from two documents inside hobkin, written for hobkin's own way of delegating.

## Decisions

- Two prompt files are added to hobkin under `src/prompts/`: `teams.md` and `team-leader.md`. They are adapted from the `teams` skill in pi-extended-teams (`~/Poetry/pi-extended-teams/skills/teams.md`) and from the user's `team-leader` skill.
- They describe hobkin's mechanism, not pi-extended-teams' tools. hobkin delegates with `hobkin session` and with work mode, and names one of four tiers (`017-model-tiers`). There is no split between read and write tiers.
- Kept from the sources:
  - The lead owns scope, integration and acceptance.
  - Delegate substantial work with independent outcomes. Keep small work direct.
  - Reject overlapping or invented lanes.
  - The context handoff card: goal, question, expected delta, known facts with sources and labels, current state, what was inspected, what not to rediscover, dependencies, constraints.
  - A report answers its expected delta with evidence.
  - Never poll. Trust quiet agents.
  - Never commit, push, deploy, install or start services without the user's word.
- Changed for hobkin:
  - Tier choice is one of fast, mid, high or max, with a short rule for each.
  - Limits are hobkin's: sessions per half hour, agents at once, the daily token budget.
  - Reports come back as hobkin's reports and wake turns.
  - A lane that changes code in a project writes its spec first (`015-specs-in-projects`).
- hobkin loads `teams.md` into the main agent's context when it is about to delegate, the way it loads its other prompts. `team-leader.md` loads when the user asks for it by name or when work mode plans a batch.
- The client shows the result of this guidance: each agent's mission card (goal, question, expected delta, tier) is readable from its node on the Work map.

## Out of scope

- Porting pi-extended-teams' tools (`spawn_agent`, file claims, grouped delivery). hobkin's sessions and work mode stay the mechanism.
- Changing the user's own `teams` and `team-leader` skills.

## Acceptance

- A1. hobkin's package contains `src/prompts/teams.md` and `src/prompts/team-leader.md`, and neither names a tool or tier that hobkin does not have.
- A2. When the main agent delegates through `hobkin session`, the brief it writes contains the handoff card's fields, and the command names a tier.
- A3. Asked to do one small task, the main agent does not delegate. Asked for substantial work with two independent outcomes, it starts two lanes with different missions.
- A4. A session started without a tier is refused with a message that names the four tiers.
- A5. An agent's node on the Work map shows its mission card: goal, question, expected delta and tier.
- A6. The guidance tells the lead to end its turn while only delegated work can advance, and hobkin wakes it when a report arrives.

## Proof

- A1. `test/cli-teams-prompt.test.mjs` (in hobkin) › "the guidance names only hobkin's tools and tiers"
- A2. `test/cli-teams-prompt.test.mjs` (in hobkin) › "a delegated brief carries the handoff card and a tier"
- A3. check: with a live model in the development home, give hobkin one small task, then one with two independent outcomes, and read what it starts.
- A4. `test/cli-session-tier.test.mjs` (in hobkin) › "a session needs a tier"
- A5. check: open an agent's node on the Work map.
- A6. `test/cli-teams-prompt.test.mjs` (in hobkin) › "a report wakes the lead"

## Steps

- [ ] S1 (A1). Write `teams.md` and `team-leader.md` for hobkin from the two sources.
- [ ] S2 (A2, A4, A6). hobkin: load the guidance for delegation, and require a tier and a mission on `hobkin session`.
- [ ] S3 (A5). Client: the mission card on an agent's node.
- [ ] S4 (A3). One live check in the development home.

## Open questions

- hobkin's main prompt already says that everything except conversation goes to an agent (`src/prompts/v2-runtime.md:11`). The teams guidance says small work stays with the lead. One of the two has to give. This spec assumes the teams rule wins for work inside a conversation, and that work mode keeps delegating everything.
