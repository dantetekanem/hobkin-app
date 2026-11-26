# Design

The client looks like hobkin.dev: warm cream or near-black ink, one yellow, round shapes, and the hooded character. Components follow shadcn/ui in structure and behavior, restyled with these tokens.

Source of the palette: `~/Poetry/hobkin.dev/styles.css`, lines 9 and 10.

## Color

### Base palette

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `bg` | `#F0EAD6` | `#0E0F13` | Window background |
| `gap` | `#DED4B8` | `#090A0D` | Gutters, the track behind panels |
| `tone-1` | `#E9E1C9` | `#15171D` | Sidebar, quiet bands |
| `tone-2` | `#F5F0E1` | `#1B1E26` | Raised bands |
| `tone-3` | `#E3D9BD` | `#111319` | Recessed bands |
| `surface` | `#F8F4E8` | `#17191F` | Cards, popovers, the canvas panel |
| `surface-2` | `#E7DEC4` | `#20232B` | Hover, chips, selected rows |
| `text` | `#16181F` | `#F0EAD6` | Text |
| `muted` | `#5A5648` | `#A8A291` | Secondary text |
| `border` | `#DCD2B6` | `#2C303A` | Hairlines |
| `border-strong` | `#857D69` | `#6B6F7A` | Inputs, emphasized outlines |
| `accent` | `#FFC940` | `#FFC940` | The one brand color: primary buttons, focus of attention |
| `on-accent` | `#16181F` | `#16181F` | Text on accent |
| `focus` | `#16181F` | `#FFC940` | Focus ring |
| `mark` | `#16181F` | `#F0EAD6` | The hood |
| `mark-eye` | `#FFC940` | `#E8A317` | The eyes |
| `sun` | `#FFC940` | `#E8A317` | Warm highlight, spec nodes |

### Status

The site defines status colors for dark terminal panels only. Light mode needs darker text variants to pass AA on cream.

| Token | Light fill | Light text | Dark (fill and text) |
| --- | --- | --- | --- |
| `ok` | `#4CC38A` | `#17633F` | `#4CC38A` |
| `warn` | `#FF8A3D` | `#9A4A00` | `#FF8A3D` |
| `bad` | `#FF7A6E` | `#B3261E` | `#FF7A6E` |

### Mapping to shadcn tokens

shadcn's `accent` means a quiet hover surface, which is not hobkin's yellow. The yellow maps to `primary`.

| shadcn token | hobkin token |
| --- | --- |
| `background` / `foreground` | `bg` / `text` |
| `card`, `popover` (and their foregrounds) | `surface` / `text` |
| `primary` / `primary-foreground` | `accent` / `on-accent` |
| `secondary` / `secondary-foreground` | `surface-2` / `text` |
| `muted` / `muted-foreground` | `tone-1` / `muted` |
| `accent` / `accent-foreground` | `surface-2` / `text` |
| `destructive` | `bad` (light text variant in light mode) |
| `border` | `border` |
| `input` | `border-strong` |
| `ring` | `focus` |
| `sidebar` and its family | `tone-1`, `text`, `accent`, `surface-2`, `border`, `focus` |

### Graph colors

Node kinds are told apart by icon and label first and by color second.

| Kind | Color | Notes |
| --- | --- | --- |
| Spec and acceptance | `sun` | The intent of the change |
| Test | `ok` | Turns `bad` when a test failed, `muted` when not run |
| Code | periwinkle, `oklch(0.62 0.09 265)` dark and `oklch(0.45 0.09 265)` light | The site's ridge hue |
| File (config, docs, assets) | `muted` | |
| Context (unchanged code) | `border-strong`, dashed outline | |
| Deleted | `bad` | |

Wires are thin and quiet at rest, tinted by the kind of connection. An active wire carries a pulse that travels from source to target. In dark mode the active wire is yellow. In light mode yellow is too faint on cream, so the active wire is ink with a yellow pulse.

### Diff colors

Added and removed lines are tints of `ok` and `bad` mixed into the code surface, at about 20% for a line and 45% for a changed word. In dark mode the code surface is Dracula's `#282A36` and the tints use Dracula's green `#50FA7B` and red `#FF5555`.

## Type

| Role | Family | Notes |
| --- | --- | --- |
| Headings, labels, the menu, the wordmark | Space Grotesk | Wordmark weight 700, tracking -0.045em. Headings track at -0.022em |
| Reading text | The user's choice: Space Grotesk, Inter, Geist, DM Sans or Figtree | 14px in the UI, 15px in the conversation. Each face has its own weight and tracking in `tokens.css`, and carries a little more weight on the dark theme |
| Code | JetBrains Mono | 13px, line height 1.7 |

Fonts ship inside the app. It makes no request to a font service.

## Shape and density

- Buttons, inputs, tabs and chips are pills, as on the site.
- Cards use a 20px radius, the canvas 26px, node cards 14px.
- The canvas is one side of a two-sided app: flush to the top, bottom and right of the window, with a rounded, shadowed left edge as the one division. It must never read as a box inside a box. The screen menu floats over it. Screens inside the canvas avoid boxed headers and full-width bars for the same reason.
- The base radius token is 14px. Smaller controls derive from it.
- This is an app, so it is denser than the marketing site: 13 to 14px controls, 8px grid.

## Components

shadcn/ui components, added as they are needed: button, input, textarea, tabs, toggle group, tooltip, scroll area, separator, dropdown menu, context menu, dialog, sheet, popover, command, badge, card, skeleton, resizable, sonner. Icons come from Lucide.

## Motion

- Motion is done with the Motion library and CSS. Only transform, opacity and filter animate, plus color for theme changes.
- Movement uses springs, so a new target can interrupt a running animation without a jump.
- Named speeds: press 140ms, hover and small exits 160ms, small enters 220ms, theme color 450ms as on the site. Small feedback stays under 300ms. Things that travel, such as screens, panels and the camera, take 400 to 650ms and ride springs. An exit is faster than its enter.
- Curves for non-spring movement: a strong ease-out `cubic-bezier(0.23, 1, 0.32, 1)` for things entering or leaving, a strong ease-in-out `cubic-bezier(0.77, 0, 0.175, 1)` for things moving on screen, and `cubic-bezier(0.32, 0.72, 0, 1)` for sheets. Nothing eases in.
- Nothing enters from nothing. An entrance starts at 96% size and transparent.
- Movement is generous. The user rejected a small shift and fade as lacking movement. A screen crosses the whole canvas and settles on a spring: sideways along the menu, up and down into and out of an agent from the agents list. Moving from one agent to another keeps the canvas and its Stop Agent and Force Stop buttons in place: the hobkin passes sideways, as the menu's marker does, and the agent's name and work cross-fade (the user, 2026-11-12). The screen leaving falls back and fades. The pieces of the new screen land one after another, the largest first.
- Keyboard navigation moves the same way the mouse does. Springs retarget, so quick key presses never queue and never wait.
- The veil slides only its list, and its blur and tint grow in the same movement as the list arrives. A blurred backdrop does not fade with a parent's opacity, so the blur radius itself is what animates.
- Changing theme is one movement: the new theme opens in a circle from the control that was used.
- A new agent pops into its list from below and overshoots a little, like a bubble reaching the surface. While an agent works, its hood bobs and its eyes move.
- A panel grows from where it was opened.
- With reduced motion on, movement becomes a short fade, the camera cuts, and blur and pulses are off.
- The values live in one file, `ui/src/lib/motion.ts`, so they can be tuned in one place.

## The avatar

The hood and eyes from hobkin.dev, drawn as one inline SVG. Art source: `packages/hobkin/assets/animations/{light,dark}/01-idle.svg` to `18-sleepy.svg`.

- Moods: idle, hello, listening, thinking, searching, working, focused, happy, celebrating, love, wink, surprised, confused, sad, grumpy, error, dizzy, sleepy.
- The mood comes from hobkin (`src/cli/mood.mjs`), so the avatar matches the terminal face.
- The eyes follow the pointer while it is over the conversation.
- Pointer reactions match the terminal face: a click wakes a sleeping avatar, repeated pokes escalate, fast hovering makes it dizzy.
- It sits to the left of the message input at 44px. Small hoods in other hues stand for delegated agents, as in the row of hoods on the site.

## Node graph language

Borrowed from Unreal Engine's Blueprints and drawn in this palette.

- A node is a rounded card: a header tinted by kind with an icon and a title, then one line saying what changed, then small facts (size of the change, status).
- Pins sit on the left edge (what it depends on) and the right edge (what depends on it). Wires leave to the right and arrive from the left, as smooth curves with horizontal ends.
- Columns read left to right: spec, tests, code, context.
- Focus: the focused node is sharp with an accent ring, its neighbors are slightly dimmed, and the rest is blurred and faded.
