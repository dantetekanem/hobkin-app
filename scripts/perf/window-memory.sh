#!/bin/zsh
# Reads what the running window holds in memory, by kind: its whole footprint, its graphics surfaces (how many, how
# much, and how many are 1024x1024 tiles of a tall scrolling layer), and the live part of its script heap.
# It only reads (footprint, ps) the window's content process: it never connects to the app.
#
# usage: scripts/perf/window-memory.sh [samples=1] [seconds between=30]

samples=${1:-1}
every=${2:-30}

# The app's content process is the WebKit one with the most CPU time.
pid=$(ps -axo pid,time,command | grep "WebKit.WebContent" | grep -v grep | sort -k2 -r | head -1 | awk '{ print $1 }')

echo "time,pid,footprint_mb,graphics_mb,surfaces,tiles_1024,script_heap_mb"
for sample in $(seq 1 "$samples"); do
  footprint -v "$pid" 2>/dev/null | python3 -c '
import re, sys, time
text = sys.stdin.read()
whole = re.search(r"Footprint: (\d+) MB", text)
# One line per surface the process owns: its dirty size in 16 KB pages.
surfaces = [int(found.group(1)) * 16 / 1024 for found in re.finditer(r"unmapped \[[0-9a-f]+\]\s+\d+\s+(\d+)\s+\d+\s+\d+\s+Owned physical footprint \(unmapped\) \(graphics\)", text)]
heap = re.search(r"\n\s*([\d.]+) (KB|MB|GB)\s+\S+ \S+\s+[\d.]+ \S+\s+\d+\s+WebKit malloc\n", text)
heap_mb = float(heap.group(1)) * {"KB": 1 / 1024, "MB": 1, "GB": 1024}[heap.group(2)] if heap else -1
tiles = sum(1 for size in surfaces if 4.0 <= size <= 4.1)
print("%s,%s,%s,%.0f,%d,%d,%.0f" % (time.strftime("%H:%M:%S"), sys.argv[1], whole.group(1) if whole else "?", sum(surfaces), len(surfaces), tiles, heap_mb))
' "$pid"
  if [ "$sample" -lt "$samples" ]; then sleep "$every"; fi
done
