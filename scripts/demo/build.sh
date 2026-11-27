#!/bin/zsh
# Builds what the demo shots run, from one commit, in a copy: hobkin-client's window in a production build with the
# demo page hook (page/) loaded first, and the host, hobkin's runtime and this folder's scripts as they are at that
# commit, so nobody's uncommitted work shows up in a shot. The hook hands the page the demo host's address the way the
# Mac shell does, and lets no socket open anywhere else.
#   scripts/demo/build.sh <out folder> [commit, default HEAD]
# Leaves <out>/dist (the window) and <out>/src (the copy the host and the seed run from).
set -euo pipefail
HERE=${0:A:h}
REPO=${HERE:h:h}
OUT=${1:?say where to build, e.g. /private/tmp/hobkin-demo/build}
COMMIT=${2:-HEAD}
mkdir -p $OUT
OUT=${OUT:A}
SRC=$OUT/src
rm -rf $SRC $OUT/dist
mkdir -p $SRC/node_modules $SRC/scripts
git -C $REPO archive $COMMIT ui shared packages integrations host vite.config.ts package.json tsconfig.json | tar -x -C $SRC
git -C $REPO rev-parse --short $COMMIT > $OUT/commit.txt
# The installed packages are the repository's, except hobkin itself, which is the copy's.
for entry in $REPO/node_modules/*(D); do [[ ${entry:t} == hobkin ]] || ln -s $entry $SRC/node_modules/${entry:t}; done
ln -s $SRC/packages/hobkin $SRC/node_modules/hobkin
ln -s $REPO/packages/hobkin/node_modules $SRC/packages/hobkin/node_modules
cp -R $HERE $SRC/scripts/demo
cp -R $HERE/page $SRC/ui/src/demo
python3 - "$SRC/ui/src/main.tsx" "$SRC/ui/src/lib/host/discover.ts" <<'PY'
import sys, pathlib
main = pathlib.Path(sys.argv[1])
text = main.read_text()
assert "await import('./start.tsx')" in text
main.write_text("import './demo/hook.ts'\n" + text)
# A production build never asks the development handshake, and the hook hands the address. Still, the usual host's
# port is taken out of the bundle, so this window cannot reach the user's own host by any path.
discover = pathlib.Path(sys.argv[2])
text = discover.read_text()
old = "const DEV_HANDSHAKE = 'http://127.0.0.1:5188/dev/handshake'"
assert old in text
discover.write_text(text.replace(old, "const DEV_HANDSHAKE = 'http://demo.invalid/dev/handshake'"))
PY
cd $SRC
node node_modules/vite/bin/vite.js build --outDir $OUT/dist --emptyOutDir > $OUT/build.log 2>&1 || { tail -30 $OUT/build.log; exit 1; }
if grep -rl '5188' $OUT/dist --include='*.js' >/dev/null; then echo "5188 found in $OUT/dist: not serving it"; exit 1; fi
echo "built $(cat $OUT/commit.txt) into $OUT"
