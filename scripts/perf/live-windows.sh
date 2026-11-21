#!/bin/zsh
# Reads what the running app costs: CPU time of its host, window content, window GPU and shell processes over
# windows of N seconds, as a share of one core, with their memory. It only reads (ps, pgrep, top): it never
# connects to the app or its host. A window that spans a host restart reads low for the host, so drop it.
#
# usage: scripts/perf/live-windows.sh [windows=3] [seconds=60] [label]

windows=${1:-3}
secs=${2:-60}
label=${3:-live}

cpu_secs() { ps -o time= -p "$1" 2>/dev/null | awk '{ n = split($1, p, ":"); s = 0; for (i = 1; i <= n; i++) s = s * 60 + p[i]; printf "%.2f", s }'; }
rss_mb() { ps -o rss= -p "$1" 2>/dev/null | awk '{ printf "%.0f", $1 / 1024 }'; }
footprint() { top -l 1 -pid "$1" -stats mem 2>/dev/null | tail -1 | tr -d ' '; }
agents() { pgrep -P "$1" 2>/dev/null | while read child; do ps -o comm= -p "$child"; done | grep -cE "^(pi|claude)$"; }

host=$(pgrep -f "host/src/main.ts" | head -1)
shell=$(pgrep -f "target/(debug|release)/hobkin|hobkin.app/Contents/MacOS/hobkin" | head -1)
# The app's content and GPU processes are the WebKit ones with the most CPU time.
content=$(ps -axo pid,time,command | grep "WebKit.WebContent" | grep -v grep | sort -k2 -r | head -1 | awk '{ print $1 }')
gpu=$(ps -axo pid,time,command | grep "WebKit.GPU" | grep -v grep | sort -k2 -r | head -1 | awk '{ print $1 }')

echo "# $label $(date '+%Y-%m-%d %H:%M:%S') host=$host shell=$shell content=$content gpu=$gpu"
echo "window,start,agents_start,agents_end,host%,content%,gpu%,shell%,together%,host_rss_mb,content_rss_mb,content_footprint,gpu_rss_mb"
for window in $(seq 1 "$windows"); do
  start=$(date '+%H:%M:%S')
  a0=$(agents "$host")
  h0=$(cpu_secs "$host"); c0=$(cpu_secs "$content"); g0=$(cpu_secs "$gpu"); s0=$(cpu_secs "$shell")
  t0=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
  sleep "$secs"
  t1=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
  h1=$(cpu_secs "$host"); c1=$(cpu_secs "$content"); g1=$(cpu_secs "$gpu"); s1=$(cpu_secs "$shell")
  a1=$(agents "$host")
  awk -v w="$window" -v st="$start" -v a0="$a0" -v a1="$a1" -v h0="$h0" -v h1="$h1" -v c0="$c0" -v c1="$c1" \
    -v g0="$g0" -v g1="$g1" -v s0="$s0" -v s1="$s1" -v t0="$t0" -v t1="$t1" \
    -v hr="$(rss_mb "$host")" -v cr="$(rss_mb "$content")" -v cf="$(footprint "$content")" -v gr="$(rss_mb "$gpu")" 'BEGIN {
      d = t1 - t0; h = (h1 - h0) / d * 100; c = (c1 - c0) / d * 100; g = (g1 - g0) / d * 100; s = (s1 - s0) / d * 100
      printf "%d,%s,%d,%d,%.1f,%.1f,%.1f,%.1f,%.1f,%s,%s,%s,%s\n", w, st, a0, a1, h, c, g, s, h + c + g + s, hr, cr, cf, gr }'
done
