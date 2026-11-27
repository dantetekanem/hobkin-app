---
{
  "id": "016-packaging",
  "title": "A signed, notarized Mac app",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "004-signin", "014-continuity", "025-onboarding"],
  "updated": "2026-11-26"
}
---
# A signed, notarized Mac app

## Outcome

One command per chip builds hobkin for Apple silicon or Intel from one commit. It makes an app and a DMG that open on any Mac without a Gatekeeper warning: every Mach-O file in them is signed with a Developer ID, the hardened runtime and a secure timestamp, and both are notarized and stapled. The updater archive is made from that same app. The app carries its host, hobkin's runtime and its own Node, and updates itself from one feed.

## Decisions

- The app carries everything its host runs: the host's code, hobkin's runtime (`packages/hobkin`) with Pi, and the official Node that hobkin pins in `devEngines.runtime.version`, built for the app's chip. `src-tauri` starts the host on that Node (`bundled_node`). 025-onboarding covers npm and the Pi command line.
- A release build opens `~/.hobkin`. `HOBKIN_CLIENT_HOME` points it elsewhere.
- Two DMGs, as the user chose on 2026-11-13: `hobkin-alpha-<version>.dmg` for Apple silicon and `hobkin-alpha-<version>-intel.dmg`. Each chip has its updater archive, `hobkin-<version>-<chip>.app.tar.gz`, and one `latest.json` lists both.
- Builds come from commits, never from the working folder. `scripts/package/build.ts` exports the commit with `git archive`, installs its packages from the pnpm store offline, and runs that commit's own `stage.ts`, `sign.ts`, `check.ts` and `tauri build`.
- The stage keeps only native code for its chip. A package's prebuilt modules sit in folders named for a platform (`prebuilds/darwin-x64/`), and its loader picks one by the platform it runs on, so every other platform's and the other chip's are left out. Today that leaves two Mach-O files besides the app's own executable: the carried Node and pi-tui's clipboard helper (`darwin-platform.node`). pi-tui's Linux and Windows builds and its other Mac chip's are dropped.
- Tauri signs only the app's executable and the bundle, and copies resources as they are. Notarization rejects an app with any Mach-O file that lacks a Developer ID signature, the hardened runtime or a secure timestamp. So `sign.ts` signs the staged Mach-O files before `tauri build` seals them into the app.
- Node's own release asks for six entitlements, `get-task-allow` among them, which notarization rejects. The carried Node is signed with the fewest that run it (`scripts/package/node-<arch>.entitlements.plist`). `allow-jit` is for V8's compiled code. `disable-library-validation` is needed because the hardened runtime otherwise loads only native modules signed by the same team, and the carried Node loads Pi extensions from the user's folders and runs checks in the user's projects (`packages/hobkin/src/cli/pi-extensions.mjs`, `work/proof-checks.mjs`), whose modules nobody here signs. Intel also needs `allow-unsigned-executable-memory`. The app's own executable needs no entitlement.
- Tauri notarizes and staples the app inside `tauri build` when the credentials are in its environment. It then makes the DMG and the updater archive from the stapled app. `build.ts` signs the DMG, has Apple notarize it, and staples it. The credentials come from the environment: an App Store Connect API key (recommended), or an Apple ID with an app-specific password. Tauri takes the Apple ID when both are whole, so `build.ts` does too, and hands Tauri only that route's variables.
- An identity of `-` is a proof run. It signs everything ad hoc and runs every step but notarization, then stops with what notarization is missing. Nothing signed ad hoc is ever sent to Apple, and nothing of it reaches `dist/built/`, the only place `release.ts` reads.
- The download folder and the updater endpoint are one setting: the endpoint in `scripts/package/tauri.release.conf.json`, `https://hobkin.dev/downloads/latest.json`. `feed.ts` takes the folder from it, and every file of a release is published there. The files sit in Cloudflare R2 behind that path, since Cloudflare Pages caps a file at 25 MB.
- The user removed the old route, `https://api.hobkin.dev/downloads/`, on 2026-11-26. Installed 0.1.19 apps poll `https://api.hobkin.dev/downloads/latest.json`, so they will find no update, and their users download a new DMG once. Each installed app has its endpoint compiled in, so a later move of the downloads folder must keep `latest.json` answering at the old endpoint, or redirect it, until the apps that poll it have updated.

## Out of scope

- A universal binary: the user chose two DMGs.
- Windows and Linux (073-windows-linux).
- Uploading a release, and a download page. The user uploads `dist/release/`, `latest.json` last.

## Acceptance

- A1. `build.ts --chip aarch64` and `build.ts --chip x86_64` each build the app and the DMG from an exported commit, with that commit's scripts and packages.
- A2. A stage carries native code only for its chip: what sits in another platform's folder is left out, every Mach-O file left is built for the chip, and every package with native modules keeps one for it.
- A3. The carried Node is the official build for the chip at the version hobkin pins. Its download matches nodejs.org's SHASUMS256.txt, and it has the Node.js project's Developer ID signature before it is staged.
- A4. Every Mach-O file in `hobkin.app` is signed with `APPLE_SIGNING_IDENTITY` and the hardened runtime, and a Developer ID one has a secure timestamp. The app passes `codesign --verify --deep --strict`.
- A5. The signed Node runs the host. The signed stage passes `check.ts`. The built app, opened on a throwaway home, starts its host on the Node inside it, and the host stops when the app quits.
- A6. With a Developer ID and notary credentials, the app and the DMG are notarized and stapled. `spctl -a -t exec` accepts the app and `spctl -a -t open --context context:primary-signature` accepts the DMG, and `xcrun stapler validate` passes on both.
- A7. The updater archive holds the signed, stapled app (the same CDHash, and a stapled ticket), and its `.sig` verifies against the release config's public key.
- A8. A missing identity, credential or tool stops the build before anything is built and names the variables, never their values. An ad hoc identity runs every step but notarization and then stops with what is missing.
- A9. The carried Node has only the entitlements it needs on its chip.
- A10. The download folder and the updater endpoint are one setting.
- A11. `release.ts` publishes only notarized builds, of one version and one commit.

## Proof

- A1. check: the ad hoc proof run of `build.ts` for each chip.
- A2. `host/test/package-binaries.test.ts` › "drops a native binary only from a folder named for another platform or the other Mac chip", "a Mach-O file runs on a chip when lipo lists its architecture", "tells Mach-O files ... from everything else"; check: the stage's list of kept and dropped files.
- A3. `host/test/package-stage.test.ts` › "accepts only a standalone official Node for the stage's chip"; check: the build's checksum line.
- A4. `host/test/package-sign.test.ts` › "a signature passes with the hardened runtime ...", "signs with the hardened runtime and a secure timestamp ..."; check: the build's list of Mach-O files and its `codesign --verify` output.
- A5. check: `check.ts` and the build's open check on a throwaway home.
- A6. check: the build's `spctl` and `stapler` output, once there is a Developer ID.
- A7. `host/test/package-sign.test.ts` › "an updater archive passes only with a signature the release's public key made ..."; check: the build's archive line, and the verifier against the published 0.1.19 archives.
- A8. `host/test/package-sign.test.ts` › "says which variables are missing ...", "an ad hoc identity is a proof run ..."; check: the build with nothing set, and the ad hoc run's last words.
- A9. check: a hardened, ad hoc signed Node with each set of entitlements, running JIT code, WebAssembly and pi-tui's helper.
- A10. `host/test/package-release.test.ts` › "the files are published beside the feed the release config's updater reads ...".
- A11. check: read `release.ts`.

## Steps

- [x] S1 (A2, A3). Stage for a chip. d5bfb5c, 2406237. `package-stage.test.ts` 11 of 11, `package-binaries.test.ts` 3 of 3. Seen in the ad hoc runs on 2026-11-26: the Apple silicon stage kept `node/bin/node` and pi-tui's `darwin-arm64` helper and left out the other five builds of it; the Intel stage kept the `darwin-x64` one. Node 26.3.1 matched SHASUMS256.txt for both chips.
- [x] S2 (A4, A9). Sign the staged Mach-O files. 70dc714. Seen on a copy of Node 26.3.1 signed ad hoc with the hardened runtime. On Apple silicon, `allow-jit` alone runs JIT code and WebAssembly. Without `disable-library-validation`, pi-tui's helper is refused ("mapping process and mapped file (non-platform) have different Team IDs"). On Intel under Rosetta, `allow-jit` alone stops V8 at start ("Check failed: 12 == (*__error())"), and `allow-unsigned-executable-memory` lets it run. Not checked on an Intel Mac.
- [x] S3 (A1, A4, A5, A7, A8). One build command per chip, proved ad hoc. 70dc714. `package-sign.test.ts` 8 of 8. On 2026-11-26 both chips were built ad hoc from a commit holding these scripts. In each app, all three Mach-O files show `flags=0x10002(adhoc,runtime)`. `codesign --verify --deep --strict` says valid on disk, and `check.ts` passes on the signed stage, with the helper loaded. The archive's app has the app's CDHash, and its `.sig` verifies against the config's key. Opened on a throwaway home, each app ran its host on the Node inside it (Intel under Rosetta), and the host stopped when the app quit. Each run then stopped with the missing-credentials error. With nothing set, the build stops before it starts and names the variables. The signature verifier also accepts the published 0.1.19 archives and refuses a changed byte. Not checked: a Developer ID signature's `Authority=` and `Timestamp=` lines, since there is no certificate yet.
- [ ] S4 (A6). Notarize and staple, once the user has a Developer ID and notary credentials. As expected for an ad hoc build, `spctl` rejects the app and the DMG ("no usable signature"), and `stapler validate` finds no ticket on either. Nothing was sent to Apple.
- [x] S5 (A10, A11). One download setting, and releases only from notarized builds. 318e7bd, 70dc714. `package-release.test.ts` 4 of 4.

## How to release

With the Developer ID Application certificate in the login keychain and an App Store Connect API key:

```
. "$HOME/.cargo/env"
export APPLE_SIGNING_IDENTITY="Developer ID Application: <name> (<team id>)"
export APPLE_API_KEY=<key id> APPLE_API_ISSUER=<issuer id> APPLE_API_KEY_PATH=<path to AuthKey_<key id>.p8>
export TAURI_SIGNING_PRIVATE_KEY=<path to the updater key>
node scripts/package/build.ts --chip aarch64 --commit <sha>
node scripts/package/build.ts --chip x86_64 --commit <sha>
node scripts/package/release.ts "What changed."
```

The Apple ID route takes `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID` in place of the three `APPLE_API_*` variables.

## Open questions

- Tauri passes no `--timestamp` when it signs the app's executable and the DMG. codesign timestamps a Developer ID signature by default, and `build.ts` checks for `Timestamp=` on every Mach-O file and signs the DMG itself with `--timestamp`. The first real build shows whether the app's executable has one.
- `allow-unsigned-executable-memory` on Intel was proved under Rosetta, not on an Intel Mac.
