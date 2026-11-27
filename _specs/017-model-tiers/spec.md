---
{
  "id": "017-model-tiers",
  "title": "Model tiers for delegated work",
  "kind": "work",
  "status": "draft",
  "depends": ["002-host", "004-signin"],
  "updated": "2026-11-26"
}
---
# Model tiers for delegated work

## Outcome

hobkin delegates by tier. There are four: fast, mid, high and max. Each one is a model plus a thinking level that the user picks in a lightbox. When hobkin starts an agent it names a tier, never a model. Changing a tier changes every later run that uses it.

The idea comes from pi-extended-teams, which maps eight tiers to models (`~/Poetry/pi-extended-teams/src/utils/settings.ts`). hobkin uses four and does not separate reading from writing.

## Decisions

### The tiers

| Tier | Meant for |
| --- | --- |
| `fast` | Collecting, searching, small mechanical edits |
| `mid` | Ordinary features, reviews and checks |
| `high` | Work that spans a system or needs careful analysis |
| `max` | Rare, high-risk work: security, data, recovery |

- A tier is `{ model, effort }`, where `model` is Pi's `provider/id` and `effort` is a thinking level that model supports.
- Tiers live in hobkin's `config.json` under `tiers`, next to `main` and `background`. The terminal app reads the same setting.
- A tier that is not set follows a model hobkin already has: `fast` the checks model, since it collects and searches, and the others the main chat's model, since they write what gets merged. In work mode it keeps the effort its level always gave.
- The main chat keeps its own model and effort. It is the lead, not a tier.

### Where tiers are used

- `hobkin session` takes `--tier <name>`. The main agent chooses the tier for each delegation, following the guidance in `018-teams-guidance`.
- Work mode maps a project's level to tiers for its two kinds of run. A user can override the tier of one item.

  | Project level | Look | Do |
  | --- | --- | --- |
  | casual | fast | mid |
  | important | mid | high |
  | critical | high | high |
  | max | max | max |

- A routine may name `tier` in its frontmatter in place of `model` and `effort`.
- A change review (`032-change-review`) uses two tiers, each a choice of one of the four: the Reviewer builds it, on `high` until the user names another, and Quick checks it, on `fast`. They are kept in `config.json` under `review`, and the Models window sets them.
- Every run records the tier it used and the model and effort that tier resolved to, so a later change of the tier does not rewrite history.

### The first models

On the user's word of 2026-11-26: "after subscription is detected, we need to have it setting the default models on what is available."

- Before this, a new home named no model. `initialize` writes the chat and the checks with no model at medium and no tiers, so the chat, the checks and every tier ran on whatever Pi starts with: Pi's saved default when its provider is connected, and otherwise Pi's default for the first connected provider in Pi's own table (`findInitialModel` in pi-coding-agent's model resolver), all at medium. With one subscription that is its default for everything: OpenAI Codex's GPT-6.1 Sol, Anthropic's Claude Opus 4.8, GitHub Copilot's GPT-6.1 Sol. Fast never got a cheaper model and max never thought harder. With several accounts, Pi's table decides. It puts Amazon Bedrock first and DeepSeek before GitHub Copilot, so a key in the environment could win over a subscription.
- Now the first-run setup sets hobkin's model and the four tiers once, when its account step finds an account Pi reaches or a sign-in connects one (`tiers.first`, `025-onboarding`). The pick is one pure rule, `pickFirstModels` in `shared/tiers/first-models.ts`, over the models Pi lists as usable now, with Pi's default per provider, each model's thinking levels and its price, which the models slice now carries. Pi gives no speed. Its thinking levels already say whether a model reasons: one that cannot lists only `off`.
- One provider gives every pick. Within it, everything starts on Pi's default for that provider, or, with no default Pi can use, on the first model Pi lists that thinks. hobkin and mid think at medium, Pi's own starting level, high at high, and max at the most that model allows. Fast takes the cheapest model of the same kind (the id's first word, such as `gpt` or `claude`) that reaches the default's strongest thinking level and costs less by Pi's prices, at low. With no such model, or no prices, fast is the default at low. A level a model lacks moves to the nearest one it has.
- With several accounts connected, the provider is chosen in this order, a decision the user can change (`PROVIDER_ORDER` and `standing` in `first-models.ts`). On the user's word of 2026-11-26: "we by default will support openai and claude code, and even so, pi is required, so alpha will need API or OpenAI subscription." Claude's subscription is used through Claude Code agents, not through Pi.
  1. The OpenAI subscription: OpenAI Codex (`openai-codex`, the setup's own sign-in), then OpenAI (`openai`) signed in with ChatGPT.
  2. Then a provider reached any other way than a subscription's sign-in: an API key, the environment, the cloud or a work computer's launcher. OpenAI's first, then Pi's order.
  3. Then the other subscriptions, such as Anthropic's Claude Pro or Max and GitHub Copilot, in Pi's order, so they are used only when nothing else is connected.
- Within a provider the pick stays on Pi's own default, on the user's word of 2026-11-26, even where Pi lists a newer model, such as Claude Opus 5.5 beside Pi's default Claude Opus 4.8.
- What a new home gets with one subscription, from Pi 1.5.0's catalog. OpenAI Codex: hobkin on GPT-6.1 Sol at medium, fast on GPT-6 Luna at low, mid, high and max on GPT-6.1 Sol at medium, high and max. Claude Pro or Max: Claude Opus 4.8 (Pi's default for Anthropic) at medium, fast on Claude Haiku 5.5 at low, the rest on Claude Opus 4.8 at medium, high and max. GitHub Copilot: as OpenAI Codex, on Copilot's own GPT-6.1 Sol and GPT-6 Luna. Pi lists a provider's whole catalog once it is connected, so a model a plan leaves out can still be picked. Pi's default is the one the account most surely has, which is why everything but fast stays on it.
- Only a home where nothing was ever chosen gets them: hobkin's config names no model for the chat, the checks or any tier, as `initialize` writes it. Nothing clears the chat's model once it is set (hobkin's settings, the Models window and the terminal each save a model), so setting it also marks the home as chosen, and the rule never runs there again. No other marker is kept. The chat's model is saved first, then the tiers in one write. Should the tiers fail, they follow the chat's model, and the home still reads as chosen.
- The checks model is left as it is, so routines without a tier still run on what Pi starts with. pi-extended-teams' tiers follow the four once they name models, as `teams-tiers.mjs` keeps them equal to hobkin's.

### The lightbox

- It also opens by command, so hobkin can open it too.
- It shows the lead and the four tiers as five cards in a row. A card has the tier's name, what it is for, the chosen model and the thinking level.
- Choosing a model opens a searchable list of the models Pi reports as available, grouped by provider, with each model's context size. Choosing a thinking level offers only the levels that model supports.
- A card shows where the tier is used right now: how many running agents and which routines.
- Changes apply when the user confirms. Cancel and Escape discard them. Running agents keep the model they started with.
- The lightbox rises into the middle of the window with weight, and its cards land one after another. The rest of the window dims and blurs. The model list slides up over the cards, inside the lightbox.
- It opens from the Models tile in Settings (`020-settings`) and from the tier label on any agent, which opens it on that tier.
- Everything in it works from the keyboard: Tab moves through the cards, the model list filters as the user types and is walked with Down and Up, Enter chooses, Escape closes the list and then the lightbox, and Cmd+Enter applies.

## Out of scope

- Per-project tiers.
- External harnesses per tier, which pi-extended-teams supports, other than Claude Code. Since 2026-11-21 a tier may run on Claude Code, chosen from the model list's Claude Code group, and keeps its Pi model here (`033-claude-code-agents`).
- Cost budgets per tier. Work mode's daily token budget stays as it is.

## Acceptance

- A1. The lightbox lists the lead and the four tiers, each with its current model and thinking level. An unset tier shows the lead's values and says it follows the lead.
- A2. The model list contains exactly the models Pi reports as available for the signed-in providers, and typing filters it by name and provider.
- A3. The thinking levels offered for a tier are the levels its chosen model supports. Choosing a model that lacks the current level moves the level to the nearest supported one and says so.
- A4. Confirming writes `tiers` to hobkin's `config.json`, and `hobkin` in the terminal reports the same tiers afterwards. Cancel writes nothing.
- A5. `hobkin session --tier fast` starts its agent with the fast tier's model and effort. An unknown tier name is refused with the four valid names.
- A6. A work run for an important project's "do" uses the high tier, and its run record names the tier, the model and the effort.
- A7. A routine with `"tier": "mid"` runs with the mid tier's model and effort. A routine naming both `tier` and `model` is a definition error.
- A8. Changing a tier while an agent is running does not change that agent. The next agent of that tier uses the new values.
- A9. Each agent in the sidebar and on the Work map shows its tier.
- A10. hobkin can read the tiers and open the lightbox through commands, and cannot change a tier without the user confirming in the lightbox.
- A11. Wherever a thinking level is chosen (a tier's card, the first-run setup, a durable hobkin on a model of its own), the choices are exactly the levels Pi lists for that model, in Pi's order, `max` among them when the model has it. A level the model does not have is never offered. hobkin's host takes `max` for its own model, for a tier and for a durable hobkin, and a tier at `max` on Claude Code runs at Claude Code's `max`.
- A12. With the model list open, the lightbox's title and the search stay at the top and its footer at the bottom, at every window size the app allows (1100 by 640 and up). The list takes the room between them and is the only thing that scrolls. When it opens, the chosen model is in view and nothing else moves. The tier cards scroll in the same room and never cover the footer.
- A13. With one account connected, the first models are Pi's default for it, with hobkin and mid at medium, high at high and max at the most the model allows, and fast on the cheapest model of the same kind that reaches the default's strongest level and costs less, at low. With no such model, or no prices, fast is the default at low. A level a model lacks moves to the nearest one it has. With no default Pi can use, they start on the first model Pi lists that thinks.
- A14. With several accounts connected, the first models come from one provider: the OpenAI subscription (OpenAI Codex, then OpenAI signed in with ChatGPT), then a provider reached by a key or any way but a subscription's sign-in (OpenAI's first, then Pi's order), then the other subscriptions in Pi's order. A provider that is not connected, or that Pi lists no model for, is passed over.
- A15. The first models are set only on a home whose config names no model for the chat, the checks or any tier. Once they are set the home reads as chosen, so a second call sets nothing, and a model chosen before is never overwritten. With no account Pi can use, nothing is set. The scripted host sets nothing.
- A16. Set on a live host, the first models are in hobkin's `config.json` and the open conversation answers on hobkin's new model at once. The host answers with what it set, each model with its name, so the setup can say it.

## Proof

- A1. `host/test/tiers.test.ts` › "lists the lead and four tiers with fallbacks"
- A2. `host/test/tiers.test.ts` › "offers the models Pi reports"
- A3. `host/test/tiers.test.ts` › "clamps the thinking level to the model"
- A4. `host/test/tiers.test.ts` › "confirm writes config and cancel does not"
- A5. `test/cli-session-tier.test.mjs` (in hobkin) › "a session resolves its tier"
- A6. `test/cli-work-tier.test.mjs` (in hobkin) › "a work run records its tier and what it resolved to"
- A7. `test/cli-routine-tier.test.mjs` (in hobkin) › "a routine may name a tier, and not both"
- A8. `host/test/tiers.test.ts` › "a change applies to later runs only"
- A9. check: start two scripted agents of different tiers and read their labels.
- A10. `host/test/tiers.test.ts` › "a tier change from hobkin needs the user's confirmation"
- A11. `shared/test/tiers.test.ts` › "the thinking levels are Pi's seven, weakest first, and the ones the host accepts for hobkin", "a model that thinks at max keeps max, and one that stops at xhigh moves down to it" and "the host takes max for a tier, for hobkin's own model and for a durable hobkin on a model of its own"; `shared/test/tiers-from-pi.test.ts` › "every level Pi lists for a model is kept in Pi's order, max included"; `host/test/claude-code-harness.test.ts` › "starts claude headless with the run's settings" (a tier at max runs at Claude Code's own max). Seen 2026-11-13 in a still render: a card on a model with `max` offers off to max, one on a model that stops at xhigh offers no max.
- A12. `ui/test/tiers-list-scroll.test.ts` (the list scrolls itself, and only itself, to show the chosen model). Seen 2026-11-13 in still renders at 1100 by 640 and 1440 by 900 with 43 models: title and search at the top, footer at the bottom, list and cards clipped between them. A still does not scroll, so the opening scroll is proved by the rule and the code, not seen.
- A13. `shared/test/tiers-first.test.ts` › "one subscription: hobkin and its tiers start on Pi's default for it, fast on the cheapest model of its kind, each thinking a little more" (OpenAI Codex, Anthropic and GitHub Copilot, on Pi 1.5.0's models and prices), "a thinking level a model lacks moves to the nearest it has, and max takes the most it allows", "fast stays on the default when nothing cheaper of its kind thinks as hard, or when Pi knows no prices", "with no default Pi can use, the first model Pi lists that thinks", "a default whose id holds a slash is found as Pi names it" and "a provider whose models cannot think gets its first model on every tier, thinking off"; `host/test/models-price.test.ts`.
- A14. `shared/test/tiers-first.test.ts` › "several accounts: the OpenAI subscription first, then keys with OpenAI's first, and other subscriptions last, each in Pi's order" and "only a connected provider Pi lists a model for counts".
- A15. `host/test/first-models.test.ts` › "a new home gets hobkin's model and every tier from the account, the chat's first, and hears what was set", "a model chosen before, for the chat, the checks or any tier, is never overwritten", "with no account Pi can use, nothing is set" and "hobkin's own config tells a new home from one where a model was chosen"; `host/test/first-models-live.test.ts` › "the scripted host sets nothing".
- A16. `host/test/first-models-live.test.ts` › "on a new home the setup's account step sets hobkin's model and tiers from the account once, and the first chat runs on them": a live host on Pi's own catalog with one DeepSeek key and a fake model server. Not seen with a real subscription, since no run here may sign in or reach a model.

## Steps

- [ ] S1 (A4, A5, A7). hobkin: `tiers` in config with validation, tier resolution, `--tier` on `hobkin session`, `tier` in routine frontmatter.
- [ ] S2 (A6, A8). hobkin: work levels mapped to tiers, and the tier recorded on each run.
- [x] S3 (A1, A2, A3, A10). Host: tier state and commands. Done 2026-11-12: hobkin holds the tiers (`tiers` and `review` in its config.json), `hobkin session` takes `--tier` and refuses a job without one, work mode names a tier by level, and the host reads and saves them with `tiers.read` and `tiers.apply`.
- [ ] S4 (A1, A2, A3, A4). UI: the lightbox. Its list comes from Pi (2026-11-10): `choicesFromPi` in shared/tiers/from-pi.ts maps the host's models slice, and the window offers the models Pi can use once a host answers (44 from the scripted dev host), sample ones before. Apply sets hobkin's own main model through the host's `models.select` (004 A21), which saves it in hobkin's config and switches the open conversation; a refusal shows the host's reason and applies nothing (seen 2026-11-10 with the scripted host). The thinking levels are Pi's own: off, minimal, low, medium, high, xhigh. Left: saving the four tiers through the host (they need hobkin's tiers config, S1), and real defaults from the first-run setup (025).
- [ ] S5 (A9). Tier labels on agents.
- [x] S6 (A13, A14, A15, A16). The first models from the account the setup finds, the real defaults S4 left for 025. Built on 2026-11-26: the pure rule, Pi's price in the models slice, `tiers.first` in the host and the setup's call and bubble (`025-onboarding` A75). Checked with tests on fakes and one live host on Pi's catalog with a key for a fake server. Not checked: a real sign-in, a real model, the window.

## Open questions

- hobkin's `max` work level runs on Claude in a Herdr pane today (`src/cli/work/store.mjs:9`), because Pi could not run that model. With tiers, `max` is whatever the user picks through Pi. Should the terminal app keep the Claude pane as a fallback when the `max` tier is unset?
- `config.background` sets the model for routines today. Should it become an alias for one tier (mid), or stay as its own setting?
- The level table above is a proposal. hobkin's current efforts per level are low, medium, high, xhigh and max (`src/cli/work/store.mjs:8-12`), which do not map one to one onto four tiers.
