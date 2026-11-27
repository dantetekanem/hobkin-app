#!/bin/zsh
# Takes the hobkin.dev screenshots from made-up data: builds the window and the host at a commit, seeds a throwaway
# home and throwaway projects, starts a scripted host on them, drives Safari and cuts each shot. See README.md.
#   scripts/demo/shoot.sh <out folder> [commit]          everything, then stops what it started and removes the demo folder
#   scripts/demo/shoot.sh prepare [commit]               only build, seed and start the host, the page and Safari
#   scripts/demo/shoot.sh reseed [commit]                build and seed again and restart the host; Safari stays as it is
#   scripts/demo/shoot.sh shots <out folder> [names...]  only the shots, on what `prepare` started
#   scripts/demo/shoot.sh stop                           quits Safari, stops the host and the page, removes the demo folder
set -uo pipefail
HERE=${0:A:h}
# Short and free of anyone's name, because folders show on screen.
DEMO=/private/tmp/hobkin-demo
PAGE_PORT=5291
HOST_PORT=5292
NODE=$(command -v node)
# The host and the seed see a home of their own and a PATH without the Mac user's tools: no real ~/.pi, ~/.claude,
# ~/.gitconfig or ~/.hobkin is ever read, and the `claude` they find is the demo's stub.
DEMO_ENV=(HOME=$DEMO/user PATH=$DEMO/user/bin:${NODE:h}:/usr/bin:/bin:/usr/sbin:/sbin)

stop() {
  pkill -x Safari 2>/dev/null
  [[ -f $DEMO/state/host.pid ]] && kill $(cat $DEMO/state/host.pid) 2>/dev/null
  [[ -f $DEMO/state/page.pid ]] && kill $(cat $DEMO/state/page.pid) 2>/dev/null
  sleep 2
  # Safari can come back by itself with the demo tab restored; only one whose windows are all the demo's is quit again.
  for i in 1 2 3 4 5; do
    sleep 1
    pgrep -x Safari >/dev/null || continue
    echo "Safari came back by itself: quitting it again"
    pkill -x Safari
  done
  rm -rf $DEMO
}

start_host() {
  env $DEMO_ENV $NODE $DEMO/build/src/host/src/main.ts --home $DEMO/home --port $HOST_PORT --origin http://127.0.0.1:$PAGE_PORT > $DEMO/state/$1.log 2>&1 &
  echo $! > $DEMO/state/host.pid
  for i in {1..60}; do grep -q 'listening' $DEMO/state/$1.log 2>/dev/null && return 0; sleep 0.5; done
  echo "the host did not start:"; cat $DEMO/state/$1.log; return 1
}

# Builds at a commit and seeds a fresh home and fresh projects, then starts the host on them. Safari and the page are left as they are.
reseed() {
  local commit=${1:-HEAD}
  [[ -f $DEMO/state/host.pid ]] && kill $(cat $DEMO/state/host.pid) 2>/dev/null && sleep 2
  rm -rf $DEMO/home $DEMO/code $DEMO/user
  mkdir -p $DEMO/user/bin $DEMO/code $DEMO/state
  $HERE/build.sh $DEMO/build $commit || exit 1
  swiftc -O -o $DEMO/state/window-id $HERE/window-id.swift || exit 1
  # Claude Code as the host finds it: a stub that answers its version and sign-in, and runs nothing.
  cat > $DEMO/user/bin/claude <<'EOF'
#!/bin/sh
case "$1" in
  --version) echo "2.1.42 (Claude Code)" ;;
  auth) echo '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}' ;;
  *) echo "The demo's Claude Code runs nothing." >&2; exit 1 ;;
esac
EOF
  chmod +x $DEMO/user/bin/claude
  # The first start makes the home as the app does; the seed then fills it while no host holds it.
  start_host host-init || exit 1
  kill $(cat $DEMO/state/host.pid); sleep 2
  (cd $DEMO/build/src && env $DEMO_ENV $NODE scripts/demo/seed.ts $DEMO) || exit 1
  start_host host || exit 1
}

prepare() {
  local commit=${1:-HEAD}
  if pgrep -x Safari >/dev/null; then echo "Safari is already running, maybe the user's own: not touching it. Quit it first."; exit 2; fi
  for port in $PAGE_PORT $HOST_PORT; do
    if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then echo "port $port is taken"; exit 2; fi
  done
  rm -rf $DEMO
  reseed $commit
  $NODE $DEMO/build/src/scripts/demo/serve.mjs $PAGE_PORT $DEMO/build/dist $DEMO/home $DEMO/state > $DEMO/state/page.log 2>&1 &
  echo $! > $DEMO/state/page.pid
  sleep 1
  open -a Safari "http://127.0.0.1:$PAGE_PORT/?agents=0"
  sleep 3
  # A Safari that restored an earlier demo tab gets one tab: the one just opened.
  osascript -e 'tell application "Safari" to tell front window to repeat while (count of tabs) > 1' -e 'close tab 1' -e 'end repeat'
  # The window fills the screen once, here, and is never sized again: the app is drawn at a real window's size, and
  # every shot is a cut from that, never scaled.
  osascript -e "tell application \"Safari\" to set bounds of front window to {$($DEMO/state/window-id --screen)}"
  sleep 2
  echo "prepared at $(cat $DEMO/build/commit.txt), page $(cat $DEMO/state/size.json)"
}

shots() {
  local out=${1:?say where the shots go}
  shift
  mkdir -p $out
  (cd $DEMO/build/src && $NODE scripts/demo/capture.ts $DEMO ${out:A} "$@")
}

case ${1:-} in
  prepare) shift; prepare "$@" ;;
  reseed) shift; reseed "$@" ;;
  shots) shift; shots "$@" ;;
  stop) stop ;;
  ''|-h|--help) sed -n 2,8p $0 ;;
  *)
    out=$1
    trap stop EXIT
    prepare ${2:-HEAD} && shots $out
    ;;
esac
