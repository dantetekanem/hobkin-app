// For the demo capture.
//   window-id <pid>     the id of that process's biggest normal window, on screen or not, for `screencapture -l`
//   window-id --screen  the main screen's visible frame as AppleScript bounds: left, top, right, bottom
//   window-id --visible <pid>  exits 0 when that process's biggest window is on screen now, so it is being drawn
import AppKit
import CoreGraphics
import Foundation

if CommandLine.arguments[1] == "--screen" {
  guard let screen = NSScreen.main else { exit(1) }
  let whole = screen.frame, visible = screen.visibleFrame
  let top = whole.maxY - visible.maxY
  print("\(Int(visible.minX)), \(Int(top)), \(Int(visible.maxX)), \(Int(top + visible.height))")
  exit(0)
}

if CommandLine.arguments[1] == "--visible" {
  let pid = Int32(CommandLine.arguments[2])!
  let shown = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
  let on = shown.contains { ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 && (($0[kCGWindowBounds as String] as? [String: Double])?["Width"] ?? 0) > 1000 }
  exit(on ? 0 : 1)
}

let pid = Int32(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
var best: (id: Int, area: Double)? = nil
for w in list where (w[kCGWindowOwnerPID as String] as? Int32) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
  let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
  let area = (b["Width"] ?? 0) * (b["Height"] ?? 0)
  if let id = w[kCGWindowNumber as String] as? Int, area > (best?.area ?? 0) { best = (id, area) }
}
if let best { print(best.id) } else { exit(1) }
