# The restart batch of spec 052, S19

One patch, not applied: `_specs/052-ten-times-lighter/restart-batch.patch`. It touches 10 files and needs one restart of `pnpm tauri dev` plus one `pnpm install`. The version stays 0.1.22, so name the number if this batch should carry one.

## What is in it

1. An opaque window while the background opacity is 1 (A20). The new `src-tauri/src/backdrop.rs` holds a command, `window_backdrop(opacity, color)`. At 1 it gives the window an opaque background in the theme's color, marks the NSWindow opaque and sets the blur behind it to 0. Below 1 it puts back what the window opens with: transparent, clear background, 20 px blur. The blur code moves into this file from `lib.rs`, and `shell_features` now answers `backdrop: true`. The window side is `ui/src/app/window-backdrop.ts`, started from `ui/src/main.tsx` through `ui/src/lib/native.ts`. It reads the page's own computed background, so it sends at startup and whenever the theme, the opacity or a photo theme changes it. A photo theme paints solid at any opacity, so its window is opaque too. A shell without the command never says `backdrop`, and then the window calls nothing. The test is `ui/test/window-backdrop.test.ts`.
2. Cargo profiles in `src-tauri/Cargo.toml`: `[profile.dev] debug = "line-tables-only"`; `[profile.dev.package."*"] opt-level = 2, debug = false, debug-assertions = false, overflow-checks = false`; `[profile.release] lto = "thin", codegen-units = 1, strip = "symbols", panic = "unwind"`. `"*"` covers dependencies only, so the shell's own `cfg!(debug_assertions)` paths stay as they are.
3. The `popLayout` fix for every list: `patches/framer-motion@14.10.1.patch` and a new `pnpm-workspace.yaml` that registers it. The patched `PopChild` pins a leaving element with `style.setProperty(name, value, 'important')` for position, width, height and its two offsets. It remembers each of those inline values with its priority and puts them back on cleanup. The correction step still rewrites the offsets once. No `<style>` element is added to the page any more.

## Apply it

Stop the app first (Control+C where `pnpm tauri dev` runs). A save under `src-tauri/` restarts the shell by itself, but Vite keeps serving its pre-bundled framer-motion until Vite itself starts again. Stopping everything makes one restart carry both.

```sh
cd /Users/someone/Poetry/hobkin-client
P=_specs/052-ten-times-lighter/restart-batch.patch
git apply --check "$P" && git apply "$P"
pnpm install        # applies the framer-motion patch: relinks framer-motion and adds patchedDependencies to pnpm-lock.yaml
node --test ui/test/window-backdrop.test.ts
. "$HOME/.cargo/env" && pnpm tauri dev
```

The first start compiles every Rust dependency again at `opt-level = 2`. That takes a few minutes, once. After that, a rebuild of the shell's own code takes as long as it does now.

To undo: `git apply -R "$P"`, then `pnpm install`.

pnpm 11.12.0 (read in its bundle) keeps a patch as `patches/framer-motion@14.10.1.patch` with `patchedDependencies` in `pnpm-workspace.yaml`. There was no `pnpm-workspace.yaml` here, so the batch adds one; pnpm 11 ignores the `pnpm` field of `package.json` for this setting. `pnpm install` writes the patch's hash into `pnpm-lock.yaml`. A `pnpm-workspace.yaml` with no `packages` keeps the root as the only project, so `pnpm add` at the root works as before.

## What you will see

- At opacity 1, the default, the window looks the same. The windows behind hobkin are no longer blurred under it, and macOS treats them as covered, so a busy page behind it can stop drawing. During a resize the uncovered edge is the theme's color.
- Below 1 the desktop shows through, blurred, as today, from the moment the setting moves. Back at 1 the window is opaque again.
- In the moment after launch, before the page's script has run, the window is transparent with the blur, as today.
- Lists that swap with `popLayout` (an agent's steps and tasks, hobkin's speech bubble, the dock) look the same when an item leaves. In Settings, Nerd stats, "style sheets added" should stay still while an agent works (A8).
- Notifications, sounds and the version number do not change.

## What was checked, and what was not

Checked: `git apply --check` exits 0 against HEAD `cf56fa7`. `cargo check --locked --offline` of a scratch copy in its own target folder finished with no warnings. The window side's test passes (4 of 4), and `tsc` on a scratch copy of `ui/` reports no error in the three changed window files. The patched `PopChild.mjs` passes `node --check`, loads as part of framer-motion's ES entry in node, and its pin and restore ran against a fake style for left/top and right/bottom anchors. The framer patch applies to a clean copy of the package and gives the same file.

Not checked, because each needs the running app:
- That WindowServer stops blending and blurring the window and treats the windows behind as covered (A20's check: at 1 a busy page behind hobkin stops drawing; at 0.8 the desktop shows through), and the CPU it saves (`scripts/perf/live-windows.sh 3 60`, A9).
- The rounded corners, the title-bar overlay with the traffic lights, and the shadow after `setOpaque` and `invalidateShadow`.
- That nothing flashes at first paint, during a resize, or during a theme change.
- The form in which WebKit writes the root's computed background. The window reads `rgb()`, `rgba()` and `color(srgb ...)`. If WebKit gives another form, the shell is told nothing and the window stays as it is today.
- A real exit through the patched `PopChild` in a page.
- That a command without `async` runs on the main thread, where the AppKit calls must run. I read this in Tauri; I did not see it run.

## Left out: removing older notifications

The brief asked for this only if it could be done cleanly through the plugin, and it cannot. On macOS `remove_active` and `remove_all_active` of `tauri-plugin-notification` 2.8.1 call `imp::close`, which does nothing there ("`notify-rust` cannot remove a shown notification"). The same thing could be done beside the plugin, the way `clear_delivered` in `notices.rs` already works. In `notice_send`, read `NSUserNotificationCenter`'s `deliveredNotifications`, sort them by `actualDeliveryDate`, and `removeDeliveredNotification:` all but the newest two before showing the new one. mac-notification-sys treats a removed notification as dismissed, which ends its thread and its half-second timer. Two reasons it stays out. It changes what Notification Center shows, which A21 keeps as it is. And in `tauri dev` the plugin posts as Terminal, so Terminal's own notifications would be removed too. That is your call.

## A decision for you: keep the Mac awake only while something runs

What it costs now: `caffeinate -i -s -w <host pid>` runs for the host's whole life. The process itself uses no CPU and about 3 MB (`ps` on the live app: 0.0%, 3.2 MB). The cost is in what it holds: `PreventUserIdleSystemSleep` and `PreventSystemSleep`, so the Mac never sleeps on its own while the host runs. `-i` holds on battery too; `-s` holds only on AC power.

The change, if you want it:
1. In hobkin, `src/cli/stay-awake.mjs`: `stayAwake()` becomes `holdAwake(on)`. When `on` turns true it starts the same `caffeinate -i -s -w <pid>`, and when it turns false it kills that child. At most one runs at a time.
2. In `host/src/main.ts`, line 117 stops calling `stayAwake()` once at start. After each publish the host calls `holdAwake(busy)`. `busy` is true while a main chat turn, a work agent, a routine or a hobkin is running, or while a routine is due within the next 10 minutes.
3. hobkin's terminal entry (`src/cli/main.mjs:106`) keeps `stayAwake()`, or follows the same rule.
4. The Mac then sleeps when nothing runs and nothing is due soon, on battery and on power.
5. What it gives up: a routine due while the Mac sleeps runs when the Mac wakes, late (the spec's open question "Keep awake").
