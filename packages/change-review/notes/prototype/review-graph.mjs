#!/usr/bin/env node
// review-graph: deterministic node map and risk level floor (safe | mid | high) for a diff.
// Input:  pack.json from `agentic-search scan --diff <range> --output-dir <dir>`.
// Output: graph.json (schemas/graph.schema.json). No model calls.
//
//   review-graph.mjs build <pack.json> [--repo <dir>] [--config <file>] [--out graph.json]
//   review-graph.mjs apply <graph.json> <events.jsonl> [--out graph.json]
//
// Flag dominance here is line-and-indent based. It is a stand-in for an AST
// guard stack (agentic-search/CHANGES.md, change 1) and says "open" when it cannot tell.
// apply replays the whole events file from the floors, so it is safe to run repeatedly.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LEVELS = ["safe", "mid", "high"];
const worst = (levels) => levels.reduce((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a), "safe");
const here = dirname(fileURLToPath(import.meta.url));
const isTestPath = (p) => /(^|\/)(test|tests|spec|__tests__)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /_(test|spec)\.rb$/.test(p);
const LOWERING_EVIDENCE = ["off-path-identical", "equivalence-test", "differential-run", "additive-migration", "callers-resolved", "unreferenced", "flag-on-test", "real-run"];

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

// ---------- source access ----------

function sourceReader(pack, repo) {
  const cache = new Map();
  return (node) => {
    if (!cache.has(node.path)) {
      let lines;
      try {
        const rev = pack.dirty || !pack.head ? undefined : pack.head;
        const text = rev ? execFileSync("git", ["show", `${rev}:${node.path}`], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) : readFileSync(join(repo, node.path), "utf8");
        lines = text.split("\n");
      } catch {
        lines = undefined;
      }
      cache.set(node.path, lines);
    }
    const lines = cache.get(node.path);
    if (lines) return { at: (n) => lines[n - 1] ?? "", complete: true };
    // Fall back to the pack snippet: "12 +| text". Lines outside it read as empty.
    const fromSnippet = new Map();
    for (const row of String(node.snippet ?? "").split("\n")) {
      const m = row.match(/^\s*(\d+) [+> ]\|\s?(.*)$/);
      if (m) fromSnippet.set(Number(m[1]), m[2]);
    }
    return { at: (n) => fromSnippet.get(n) ?? "", complete: false };
  };
}

// ---------- flag checks inside one definition ----------

function matchFlag(text, patterns) {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return { flag: m.groups?.flag ?? "unknown", index: m.index };
  }
  return undefined;
}

const indentOf = (text) => text.search(/\S/);
const blank = (text) => !text.trim() || /^\s*(#|\/\/|\*|\/\*)/.test(text);

// Returns the gates in [start, end] and, per line, which branch of which gate it sits in.
function gateRegions(src, start, end, checks, gateId) {
  const gates = [];
  const region = new Map(); // line -> { gate, branch: on|off|scaffold|expr }
  const mark = (from, to, gate, branch) => { for (let n = from; n <= to; n += 1) region.set(n, { gate, branch }); };
  region.set(start, { branch: "scaffold" });
  region.set(end, { branch: "scaffold" });

  for (let n = start; n <= end; n += 1) {
    const text = src.at(n);
    const hit = matchFlag(text, checks);
    if (!hit) continue;
    const t = text.trim();
    const indent = indentOf(text);
    const before = text.slice(0, hit.index);
    const negated = /(^|\W)(!|not\s+)\s*$/.test(before);
    const id = gateId();
    const gate = { id, flag: hit.flag, line: n, form: "expression" };

    const jsGuard = /^if\s*\(.*\)\s*(return|throw)\b/.test(t);
    const guard = jsGuard ? ["", "", "if"] : t.match(/^(return|next|break|raise)\b.*\b(if|unless)\b/);
    const block = !guard && t.match(/^(if|unless|elsif|else if|\}\s*else if)\b/);
    const modifier = !block && !guard && before.match(/\b(if|unless)\s+(!|not\s+)?\s*$/);

    if (block) {
      gate.form = "branch";
      const first = block[1] === "unless" ? !negated : negated; // true: the first body runs with the flag OFF
      let close = n + 1;
      let elseLine;
      for (; close <= end; close += 1) {
        const line = src.at(close);
        if (blank(line) && !line.trim()) continue;
        if (indentOf(line) > indent) continue;
        const head = line.trim();
        if (indentOf(line) === indent && /^(else\b|\}\s*else\b(?!\s*if))/.test(head) && elseLine === undefined) { elseLine = close; continue; }
        if (indentOf(line) === indent && /^(elsif\b|\}\s*else if\b)/.test(head)) { elseLine = elseLine ?? close; continue; }
        break; // end, }, or dedent
      }
      const bodyEnd = (elseLine ?? close) - 1;
      mark(n, n, id, "scaffold");
      mark(n + 1, bodyEnd, id, first ? "off" : "on");
      if (elseLine !== undefined) {
        mark(elseLine, elseLine, id, "scaffold");
        mark(elseLine + 1, close - 1, id, first ? "on" : "off");
      }
      if (close <= end && close !== end) mark(close, close, id, "scaffold");
    } else if (guard) {
      gate.form = "guard";
      const leavesWhenOff = guard[2] === "unless" ? !negated : negated;
      // The guard line carries its own action (what it returns). That action runs in one flag state.
      mark(n, n, id, leavesWhenOff ? "off" : "on");
      // After the guard, the rest of the definition runs only in the other state.
      for (let rest = n + 1; rest < end; rest += 1) if (!region.get(rest)?.gate) region.set(rest, { gate: id, branch: leavesWhenOff ? "on" : "off" });
    } else if (modifier) {
      gate.form = "modifier";
      const on = modifier[1] === "unless" ? Boolean(modifier[2]) : !modifier[2];
      mark(n, n, id, on ? "on" : "off");
    } else {
      // Flag value stored or passed along: dominance is not traced.
      for (let rest = n; rest < end; rest += 1) if (!region.get(rest)?.gate) region.set(rest, { gate: id, branch: "expr" });
    }
    gates.push(gate);
  }
  return { gates, region };
}

// ---------- build ----------

function build(packPath, options) {
  const pack = JSON.parse(readFileSync(packPath, "utf8"));
  const config = JSON.parse(readFileSync(options.config ?? join(here, "review.config.json"), "utf8"));
  const repo = resolve(options.repo ?? ".");
  const read = sourceReader(pack, repo);
  const rx = (source, flags = "") => new RegExp(source, flags);
  const checks = config.flags.check.map((p) => rx(p));
  const testOn = config.flags.test_on.map((p) => rx(p));
  const testOff = config.flags.test_off.map((p) => rx(p));
  const signalRx = Object.fromEntries(Object.entries(config.signals).map(([k, v]) => [k, rx(v)]));

  const anchors = new Map(pack.anchors.map((a) => [a.id, a]));
  const fileOf = new Map(pack.files.map((f) => [f.path, f]));
  let gateCounter = 0;
  const gateId = () => `g${++gateCounter}`;

  // 1. Nodes.
  const nodes = new Map();
  const regions = new Map();
  const gates = [];
  for (const raw of pack.nodes) {
    const anchor = anchors.get(raw.id);
    const test = raw.kind === "test" || isTestPath(raw.path);
    const container = ["class", "module"].includes(raw.kind);
    const src = read(raw);
    const changedLines = (anchor?.changedLines ?? []).filter((n) => !blank(src.at(n)));
    const span = raw.endLine - raw.startLine + 1;
    const shortName = raw.symbol.split(/[#.]/).pop().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const existedBefore = (anchor?.removed ?? []).some((block) => block.lines.some((l) => new RegExp(`^\\s*(def\\s+(self\\.)?|function\\s+|(async\\s+)?)${shortName}(\\W|$)`).test(l)));
    const callable = /method|function|scope/.test(raw.kind);
    const hasRemoved = (anchor?.removed ?? []).some((block) => block.lines.some((l) => l.trim()));
    // A definition is new when its first line is new and no definition of that name was removed.
    const added = anchor ? fileOf.get(raw.path)?.status === "added" || (callable ? anchor.changedLines.includes(raw.startLine) && !existedBefore : anchor.changedLines.length >= span && !hasRemoved) : false;
    const entry = Object.entries(config.entry).filter(([, p]) => rx(p).test(raw.path)).map(([k]) => k);
    const node = {
      id: raw.id,
      kind: test ? "test" : ["method", "singleton_method", "function", "scope"].includes(raw.kind) || /method|function/.test(raw.kind) ? "function" : "general",
      detail: raw.kind,
      symbol: raw.symbol,
      path: raw.path,
      lines: [raw.startLine, raw.endLine],
      fingerprint: raw.fingerprint,
      change: anchor ? (added ? "added" : "modified") : "none",
      changed_lines: changedLines,
      tags: [...new Set([...(anchor?.boundary?.tags ?? []), ...entry])],
      entry: entry.length > 0,
      gate: { state: test ? "n/a" : anchor ? "pending" : "context" },
      signals: {},
      guards: [],
      findings: [],
      critical: false,
    };
    if (container && !anchor) node.hidden = true; // namespaces reached by reference only
    nodes.set(node.id, node);
    if (!container) {
      const found = gateRegions(src, raw.startLine, raw.endLine, checks, gateId);
      regions.set(node.id, found.region);
      for (const gate of found.gates) gates.push({ ...gate, node: node.id, origin: (anchor?.changedLines ?? []).includes(gate.line) ? "added" : "existing" });
    }
    if (anchor && !test) {
      for (const [name, pattern] of Object.entries(signalRx)) {
        // Cache keys and serializers are often named, not called, on the changed line: match the symbol too.
        const named = ["cache_key", "serialization"].includes(name) && pattern.test(raw.symbol);
        const hits = changedLines.filter((n) => named || pattern.test(src.at(n))).map((n) => ({ line: n, text: src.at(n).trim().slice(0, 120) }));
        if (hits.length) node.signals[name] = hits;
      }
      node.existed_before = !added;
    }
  }
  const gateById = new Map(gates.map((g) => [g.id, g]));
  const branchAt = (nodeId, line) => regions.get(nodeId)?.get(line);

  // 2. Edges. Call edges come from the pack; a call inside a flag branch carries the gate.
  const edges = [];
  const seen = new Set();
  const addEdge = (edge) => {
    const key = `${edge.from}>${edge.to}:${edge.type}:${edge.line}`;
    if (seen.has(key)) {
      const prior = edges.find((e) => `${e.from}>${e.to}:${e.type}:${e.line}` === key);
      if (prior && edge.resolution === "exact") prior.resolution = "exact";
      return;
    }
    seen.add(key);
    const at = branchAt(edge.from, edge.line);
    if (at?.gate && ["on", "off", "expr"].includes(at.branch)) edge.gate = { id: at.gate, branch: at.branch };
    edges.push(edge);
  };
  const unresolved = [];
  for (const edge of pack.edges) {
    if (!edge.to) {
      if (edge.resolution === "unresolved") {
        const reason = /operator call/.test(edge.note ?? "") ? "operator" : /dynamic|runtime|callback|send\b/.test(edge.note ?? "") ? "dynamic" : "unknown-receiver";
        unresolved.push({ from: edge.from, line: edge.line, name: edge.name, reason });
      }
      continue;
    }
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to || from === to || to.hidden) continue;
    if (edge.relationship === "references") continue;
    addEdge({ from: from.id, to: to.id, type: from.kind === "test" ? "tests" : "calls", resolution: edge.resolution, line: edge.line });
  }
  // Async boundaries: Const.perform_later -> Const#perform when that definition is in the pack.
  const bySymbol = new Map([...nodes.values()].map((n) => [n.symbol, n]));
  for (const raw of pack.nodes) {
    const node = nodes.get(raw.id);
    if (node.kind !== "function") continue;
    const src = read(raw);
    for (let n = raw.startLine; n <= raw.endLine; n += 1) {
      const m = src.at(n).match(/([A-Z]\w*(?:::[A-Z]\w*)*)(?:\.set\([^)]*\))?\.(perform_later|perform_async|perform_in)\b/);
      const target = m && bySymbol.get(`${m[1]}#perform`);
      if (target) addEdge({ from: node.id, to: target.id, type: "enqueues", resolution: "exact", line: n });
    }
  }
  for (const node of nodes.values()) {
    const dynamic = unresolved.filter((u) => u.from === node.id && u.reason === "dynamic");
    if (dynamic.length) node.signals.dynamic_dispatch = dynamic.map(({ line, name }) => ({ line, text: name }));
  }

  const fileClass = (path) => Object.entries(config.ungateable).find(([, p]) => rx(p).test(path))?.[0] ?? "file";
  // 3. General (non-callable) changes: load-time definitions, unparsed files, removed definitions.
  for (const file of pack.fileHunks ?? []) {
    nodes.set(file.id, { id: file.id, kind: "general", detail: file.kind, symbol: file.path, path: file.path, lines: [file.hunks[0]?.newStart ?? 1, file.hunks.at(-1)?.newStart ?? 1], change: file.status === "added" ? "added" : file.status === "deleted" ? "removed" : "modified", changed_lines: [], tags: [], entry: false, gate: { state: "ungateable", class: fileClass(file.path), reason: `${fileClass(file.path)} change takes effect at deploy, outside any flag check` }, signals: {}, guards: [], findings: [], critical: false, text: file.hunks.flatMap((h) => h.newLines).join("\n") });
  }
  (pack.dangling ?? []).forEach((item, index) => {
    if (item.stillDefined || !item.callers.some((c) => !c.test)) return;
    const id = `x${index + 1}`;
    nodes.set(id, { id, kind: "general", detail: "removed-definition", symbol: `${item.name} (removed)`, path: item.oldPath, lines: [item.oldLine, item.oldLine], change: "removed", changed_lines: [], tags: [], entry: false, gate: { state: "ungateable", class: "removed-definition", reason: "definition deleted; a flag cannot bring it back" }, signals: {}, guards: [], findings: [{ rule: "dangling-callers", severity: "critical", text: `${item.callers.filter((c) => !c.test).length} caller(s) still reference ${item.name}, which this diff removes`, by: "review-graph" }], critical: true });
    for (const caller of item.callers) if (!caller.test && nodes.has(caller.id)) addEdge({ from: caller.id, to: id, type: "dangling", resolution: "static_candidate", line: caller.line });
  });

  // 4. Gate state.
  const ungateablePath = (path) => Object.entries(config.ungateable).find(([, p]) => rx(p).test(path))?.[0];
  const incomplete = (node) => {
    const name = node.symbol.split(/[#.]/).pop();
    const texts = [...(pack.coverage.frontier ?? []), ...(pack.coverage.notes ?? [])];
    return texts.some((t) => t.startsWith(`callers of ${name}`));
  };
  for (const node of nodes.values()) {
    if (node.gate.state !== "pending") continue;
    const pathClass = ungateablePath(node.path);
    const anchor = anchors.get(node.id);
    const src = read(node);
    if (pathClass) {
      node.gate = { state: "ungateable", class: pathClass, reason: `${pathClass} takes effect at deploy for every request` };
      node.text = Array.from({ length: node.lines[1] - node.lines[0] + 1 }, (_, i) => src.at(node.lines[0] + i)).join("\n");
    } else if (node.kind === "general") {
      node.gate = { state: "ungateable", class: "load-time", reason: `${node.detail} is evaluated when the file loads, before any flag check` };
    } else {
      const region = regions.get(node.id);
      const mine = gates.filter((g) => g.node === node.id);
      const removed = new Set((anchor.removed ?? []).flatMap((block) => block.lines).map((l) => l.trim()).filter(Boolean));
      const sorted = { on: [], off: [], outside: [], expr: [] };
      for (const line of node.changed_lines) {
        const at = region.get(line);
        if (at?.branch === "scaffold") continue;
        sorted[at?.branch ?? "outside"].push(line);
      }
      const offChanged = sorted.off.filter((line) => !removed.has(src.at(line).trim()));
      const signatureChanged = node.change === "modified" && node.changed_lines.includes(node.lines[0]);
      node.in_method = { on: sorted.on.length, off_identical: sorted.off.length - offChanged.length, off_changed: offChanged, outside: sorted.outside, expr: sorted.expr.length };
      if (signatureChanged) node.signals.signature = [{ line: node.lines[0], text: src.at(node.lines[0]).trim() }];
      if (node.change === "added") {
        // A new definition has no old behaviour to preserve: its callers decide (below).
      } else if (mine.length && !sorted.outside.length && !sorted.expr.length && !offChanged.length) {
        const gate = mine[0];
        node.gate = { state: "gated", flag: gate.flag, via: "in-method", gates: mine.map((g) => g.id), origin: gate.origin, off_path: sorted.off.length ? "identical" : "untouched", reason: sorted.off.length ? "new lines sit on the flag-on branch; the flag-off branch is the removed code, re-indented" : "every changed line sits on the flag-on branch" };
      } else if (sorted.expr.length) {
        node.gate = { state: "open", reason: "flag value is stored or passed along; which lines it controls is not traced", gates: mine.map((g) => g.id) };
      } else if (offChanged.length) {
        node.gate = { state: "ungated", reason: `flag-off branch changed at line ${offChanged.join(", ")}: the old behaviour is not preserved`, gates: mine.map((g) => g.id) };
        node.findings.push({ rule: "off-path-changed", severity: "high", lines: offChanged, text: "The flag-off branch is not the code that was removed. Flag off is no longer the old behaviour.", by: "review-graph" });
      } // else: decided by callers below
    }
  }
  // Callers: a definition is gated when every production call site sits on a flag-on branch or in a gated caller.
  const callSites = (node) => edges.filter((e) => e.to === node.id && e.type === "calls" && nodes.get(e.from)?.kind !== "test");
  for (let pass = 0, moved = true; moved && pass < 20; pass += 1) {
    moved = false;
    for (const node of nodes.values()) {
      if (node.gate.state !== "pending") continue;
      const sites = callSites(node);
      const judged = sites.map((site) => {
        const caller = nodes.get(site.from);
        if (site.gate?.branch === "on") return { site, state: "gated", gate: site.gate.id };
        if (site.gate?.branch === "off") return { site, state: "ungated" };
        if (site.gate?.branch === "expr") return { site, state: "open" };
        if (caller.gate.state === "gated") return { site, state: "gated", gate: caller.gate.gates?.[0] };
        if (caller.gate.state === "pending") return { site, state: "pending" };
        return { site, state: caller.gate.state === "open" ? "open" : "ungated" };
      });
      const where = (j) => `${nodes.get(j.site.from).symbol}:${j.site.line}`;
      const hard = judged.find((j) => j.state === "ungated" && j.site.resolution === "exact");
      const soft = judged.find((j) => j.state === "ungated");
      let next;
      const allGated = sites.length && judged.every((j) => j.state === "gated");
      if (node.entry && !sites.length) next = { state: "ungated", reason: `entry point (${node.tags.filter((t) => config.entry[t]).join(", ")}) with no caller in the code: the framework calls it directly` };
      else if (hard) next = { state: "ungated", reason: `called with no flag check from ${where(hard)}${hard.site.gate?.branch === "off" ? " (the flag-off branch)" : ""}` };
      else if (judged.some((j) => j.state === "pending")) continue;
      else if (soft) next = { state: "open", reason: `a caller found by name has no flag check: ${where(soft)}` };
      else if (!sites.length) next = { state: "open", reason: "no production caller found: dynamic dispatch, a framework convention, or dead code" };
      else if (judged.some((j) => j.state === "open")) next = { state: "open", reason: "a caller's own gating is unproven" };
      else if (incomplete(node)) next = { state: "open", reason: "caller list is incomplete (name too common or more files than the scan expanded)" };
      else if (allGated && node.existed_before && !config.trust_found_callers) next = { state: "open", reason: `the ${sites.length} caller(s) found are behind the flag (${judged.map(where).join(", ")}), but this definition predates the diff: callers outside the scan are not ruled out` };
      else {
        const ids = [...new Set(judged.map((j) => j.gate).filter(Boolean))];
        const gate = gateById.get(ids[0]);
        next = { state: "gated", flag: gate?.flag, via: "callers", gates: ids, origin: gate?.origin, off_path: "untouched", reason: `every production call site is behind the flag: ${judged.map(where).join(", ")}` };
      }
      node.gate = { ...next, gates: next.gates ?? node.gate.gates };
      moved = true;
    }
  }
  for (const node of nodes.values()) if (node.gate.state === "pending") node.gate = { state: "open", reason: "call cycle: gating could not be settled" };

  // 5. Tests as guards. A test reaches a node directly, or through calls whose flag branch its flag state allows.
  const stateOf = (testNode) => {
    const src = read(testNode);
    const states = {};
    for (let n = testNode.lines[0]; n <= testNode.lines[1]; n += 1) {
      const on = matchFlag(src.at(n), testOn);
      const off = matchFlag(src.at(n), testOff);
      if (on) states[on.flag] = states[on.flag] === "off" ? "both" : "on";
      if (off) states[off.flag] = states[off.flag] === "on" ? "both" : "off";
    }
    return states;
  };
  const flagNames = [...new Set(gates.map((g) => g.flag))];
  const changedTests = new Set(pack.anchors.filter((a) => isTestPath(a.path)).map((a) => a.id));
  for (const test of nodes.values()) {
    if (test.kind !== "test" || test.hidden) continue;
    const states = stateOf(test);
    test.flag_states = states;
    test.origin = changedTests.has(test.id) ? (test.change === "added" ? "added" : "modified") : "existing";
    const queue = edges.filter((e) => e.from === test.id && e.type === "tests").map((e) => ({ id: e.to, path: [] }));
    const visited = new Set();
    while (queue.length) {
      const { id, path } = queue.shift();
      if (visited.has(id) || path.length > 4) continue;
      visited.add(id);
      const target = nodes.get(id);
      if (target.kind === "test") continue;
      const flag = target.gate.flag ?? (flagNames.length === 1 ? flagNames[0] : undefined);
      if (target.gate.state !== "context") target.guards.push({ test: test.id, symbol: test.symbol.replace(/^.*? test /, ""), origin: test.origin, flag_state: flag ? states[flag] ?? "default" : "n/a", link: path.length ? "via" : "direct", through: path });
      for (const edge of edges.filter((e) => e.from === id && e.type === "calls")) {
        if (edge.gate) {
          const state = states[gateById.get(edge.gate.id)?.flag] ?? "default";
          if (edge.gate.branch === "on" && !["on", "both"].includes(state)) continue;
          if (edge.gate.branch === "off" && state === "on") continue;
        }
        queue.push({ id: edge.to, path: [...path, id] });
      }
    }
  }

  for (const gate of gates) {
    if (gate.origin !== "added") continue;
    const host = nodes.get(gate.node);
    const text = read(host).at(gate.line).trim();
    gate.text = text.slice(0, 160);
    host.findings.push({ rule: "new-flag-check", severity: "info", lines: [gate.line], text: `The check itself runs on every call, flag on or off: \`${gate.text}\`. Its arguments are evaluated and the flag service is consulted on this path.`, by: "review-graph" });
  }

  const graph = {
    schema: "review-graph/1",
    revision: 1,
    source: { label: pack.label, base: pack.base, head: pack.head, pack: packPath },
    flags: [...new Set(gates.map((g) => g.flag))].map((name) => ({ name, sites: gates.filter((g) => g.flag === name).map((g) => g.id) })),
    gates,
    nodes: [...nodes.values()].filter((n) => !n.hidden),
    edges,
    suggestions: [],
    coverage: { ...pack.coverage, skipped_anchors: (pack.skippedAnchors ?? []).length, unresolved_by_reason: unresolved.reduce((acc, u) => ({ ...acc, [u.reason]: (acc[u.reason] ?? 0) + 1 }), {}) },
  };
  for (const node of graph.nodes) contractKey(node, graph);
  assess(graph, config);
  return graph;
}

// Contract cache key: the definition plus everything it calls. Unchanged key means the cached contract still holds.
function contractKey(node, graph) {
  if (node.kind !== "function") return;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const callees = graph.edges.filter((e) => e.from === node.id && e.type !== "tests").map((e) => byId.get(e.to)?.fingerprint).filter(Boolean).sort();
  node.contract = { key: createHash("sha256").update([node.fingerprint, ...callees].join("\n")).digest("hex").slice(0, 16), partial: Boolean(node.signals.dynamic_dispatch) };
}

// ---------- levels ----------
// safe: no human attention needed. mid: not critical, worth a look, can be improved in a fast follow.
// high: needs human attention or a fix before merge.

function assess(graph, config) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const fanIn = (node) => new Set(graph.edges.filter((e) => e.to === node.id && e.type === "calls").map((e) => e.from)).size;
  const reach = (node) => {
    const why = [];
    const sensitive = node.tags.filter((t) => config.sensitive.includes(t));
    if (sensitive.length) why.push(`sensitive: ${sensitive.join(", ")}`);
    if (config.hot.paths.some((p) => new RegExp(p).test(node.path))) why.push("hot path (config)");
    if (fanIn(node) >= config.hot.fan_in) why.push(`fan-in ${fanIn(node)}`);
    return why;
  };
  const residue = (node) => ["write", "enqueue", "serialization", "cache_key"].filter((k) => node.signals[k]);

  for (const node of graph.nodes) {
    if (node.kind === "test" || node.gate.state === "context") { node.level = null; continue; }
    const why = [];
    let floor;
    const wide = reach(node);
    const left = residue(node);
    const state = node.gate.state;
    if (node.gate.class === "removed-definition") { floor = "high"; why.push("definite break: every caller of the removed definition fails"); }
    else if (state === "ungateable") {
      const cls = node.gate.class;
      const text = node.text ?? "";
      if (cls === "migration" || cls === "schema") {
        if (new RegExp(config.migration.destructive).test(text)) { floor = "high"; why.push("destructive or locking schema change: rollback does not restore data"); }
        else if (new RegExp(config.migration.additive).test(text)) { floor = "mid"; why.push("additive schema change: applies to everyone at deploy; locking on a live table is not checked here"); }
        else { floor = "high"; why.push("schema change of unknown kind"); }
      } else { floor = wide.length ? "high" : "mid"; why.push(node.gate.reason, ...wide); }
    } else if (state === "gated") {
      const onTest = node.guards.some((g) => ["on", "both"].includes(g.flag_state) || (g.link === "direct" && node.gate.via === "callers"));
      if (left.length) { floor = "mid"; why.push(`flag-on leaves ${left.join(", ")} behind: off after on is not never on`); }
      else if (!onTest) { floor = "mid"; why.push("no test runs this with the flag on"); node.findings.push({ rule: "gated-no-on-test", severity: "medium", text: "Gated, but no test reaches it with the flag on.", by: "review-graph" }); }
      else { floor = "safe"; why.push(node.gate.reason); }
    } else { // ungated or open
      if (["write", "enqueue", "serialization"].some((k) => node.signals[k])) { floor = "high"; why.push(`runs for everyone and ${left.join(", ")} on changed lines: rollback does not undo what was written`); }
      else if (node.signals.cache_key) { floor = "high"; why.push("cache key or cached value changes for everyone at deploy: cold cache on a live path"); }
      else if (wide.length) { floor = "high"; why.push("runs for everyone at deploy", ...wide); }
      else { floor = "mid"; why.push("runs for everyone at deploy, on an ordinary path; rollback undoes it"); }
      if (state === "open") why.push(`gating unproven: ${node.gate.reason}`);
      const direct = node.guards.filter((g) => g.link === "direct");
      if (node.change === "modified" && direct.length && direct.every((g) => g.origin === "existing")) node.findings.push({ rule: "behaviour-changed-tests-unchanged", severity: "medium", text: "Changed for everyone, yet only unchanged tests touch it: either behaviour is identical or the tests do not observe the change.", tests: direct.map((g) => g.test), by: "review-graph" });
      if (!node.guards.length) node.findings.push({ rule: "no-test", severity: "medium", text: "No test references this definition.", by: "review-graph" });
    }
    node.level = { floor, current: node.level?.current ?? floor, why, if: [] };
    const hostsNewCheck = node.findings.some((f) => f.rule === "new-flag-check");
    // Which model the risk pass may spend here. Ungated work gets the full pass whatever its level.
    node.llm = node.gate.class === "removed-definition" ? "none" : floor === "safe" ? (hostsNewCheck ? "cheap" : "none") : floor === "high" || ["ungated", "open"].includes(state) ? "full" : "cheap";
  }

  // Suggestions: what would move a level, and to what. A suggestion that moves nothing is not made.
  const flag = graph.flags[0]?.name;
  const suggestions = [];
  const add = (s) => {
    if (s.moves.every((m) => m.from === m.to)) return;
    const id = `s${suggestions.length + 1}`;
    suggestions.push({ id, ...s });
    for (const move of s.moves) byId.get(move.node).level.if.push({ suggestion: id, level: move.to });
  };
  for (const node of graph.nodes) {
    if (!node.level) continue;
    const from = node.level.current;
    const gatedLevel = residue(node).length ? "mid" : "safe";
    const state = node.gate.state;
    if (node.gate.class === "removed-definition") add({ kind: "restructure", at: { node: node.id }, text: `Keep ${node.symbol.replace(" (removed)", "")} until its callers are migrated, or migrate them in a prep PR.`, moves: [{ node: node.id, from, to: "safe" }] });
    else if (state === "ungated" && node.kind === "function") add({ kind: "add-flag", at: { node: node.id, line: node.changed_lines[0] }, flag: flag ?? "(new flag)", text: `Branch on ${flag ? `:${flag}` : "a flag"} at ${node.symbol}:${node.changed_lines[0]} and keep the removed lines as the flag-off path.`, moves: [{ node: node.id, from, to: gatedLevel }] });
    else if (state === "open") add({ kind: "resolve-callers", at: { node: node.id }, text: `Prove every caller of ${node.symbol} is behind the flag (${node.gate.reason}), or gate it inside the method.`, moves: [{ node: node.id, from, to: gatedLevel }] });
    else if (state === "ungateable" && node.gate.class === "load-time") add({ kind: "restructure", at: { node: node.id }, text: `Leave ${node.symbol} as it was and introduce the new value beside it, read only on the flag-on path.`, moves: [{ node: node.id, from, to: "safe" }] });
    else if (state === "ungateable" && ["migration", "schema"].includes(node.gate.class) && from === "high") add({ kind: "restructure", at: { node: node.id }, text: "Split into expand (additive, ships first) and contract (after the flag is fully on).", moves: [{ node: node.id, from, to: "mid" }] });
    else if (state === "gated" && node.findings.some((f) => f.rule === "gated-no-on-test")) add({ kind: "add-test", at: { node: node.id }, text: `Add one test that reaches ${node.symbol} with :${node.gate.flag} on.`, moves: [{ node: node.id, from, to: gatedLevel }] });
  }
  graph.suggestions = suggestions;
  summarize(graph);
}

const best = (levels) => levels.reduce((a, b) => (LEVELS.indexOf(b) < LEVELS.indexOf(a) ? b : a), "high");

function summarize(graph) {
  const rated = graph.nodes.filter((n) => n.level);
  const count = (state) => rated.filter((n) => n.gate.state === state).length;
  graph.summary = {
    level: worst(rated.map((n) => n.level.current)),
    level_if_suggestions_applied: worst(rated.map((n) => (n.level.if.length ? best(n.level.if.map((i) => i.level)) : n.level.current))),
    critical: rated.filter((n) => n.critical).map((n) => n.id),
    by_level: Object.fromEntries(LEVELS.map((l) => [l, rated.filter((n) => n.level.current === l).length])),
    gate_numbers: { flag_sites: graph.gates.length, flags: graph.flags.length, gated: count("gated"), ungated: count("ungated"), open: count("open"), ungateable: count("ungateable") },
    review_queue: rated.filter((n) => n.llm !== "none" && !n.reviewed).sort((a, b) => LEVELS.indexOf(b.level.current) - LEVELS.indexOf(a.level.current) || Number(b.llm === "full") - Number(a.llm === "full")).map((n) => ({ node: n.id, level: n.level.current, model: n.llm })),
    reviewed: rated.filter((n) => n.reviewed).length,
  };
}

// ---------- apply risk events ----------

function apply(graphPath, eventsPath, options) {
  const graph = JSON.parse(readFileSync(graphPath, "utf8"));
  const config = JSON.parse(readFileSync(options.config ?? join(here, "review.config.json"), "utf8"));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const rejected = [];
  const extra = [];
  const events = readFileSync(eventsPath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  // Events are the whole history: start again from the floors so applying twice gives the same graph.
  for (const node of graph.nodes) {
    if (!node.level) continue;
    node.level.current = node.level.floor;
    node.level.why = node.level.why.filter((w) => !w.startsWith("risk-level: "));
    node.findings = node.findings.filter((f) => f.by === "review-graph");
    node.critical = node.gate.class === "removed-definition";
    node.questions = [];
    node.reviewed = false;
  }
  for (const event of events) {
    const node = byId.get(event.node);
    const fail = (reason) => rejected.push({ event, reason });
    if (!node?.level) { fail("unknown node, or a node that carries no level"); continue; }
    if (!LEVELS.includes(event.level)) { fail(`level must be one of: ${LEVELS.join(", ")}`); continue; }
    if (!event.evidence || !event.direction || !event.aspect) { fail("direction, aspect and evidence are required"); continue; }
    const lowers = LEVELS.indexOf(event.level) < LEVELS.indexOf(node.level.floor);
    if (lowers && !LOWERING_EVIDENCE.includes(event.evidence_kind)) { fail(`a level below the floor (${node.level.floor}) needs evidence_kind in: ${LOWERING_EVIDENCE.join(", ")}`); continue; }
    if (event.critical && event.level !== "high") { fail("critical is only valid with level high"); continue; }
    node.level.current = event.level;
    node.level.why.push(`risk-level: ${event.evidence}`);
    node.findings.push({ rule: event.rule ?? `${event.direction}/${event.aspect}`, severity: event.critical ? "critical" : event.level === "high" ? "high" : "medium", lines: event.lines, text: event.evidence, direction: event.direction, aspect: event.aspect, confidence: event.confidence, by: event.by ?? "risk-level" });
    if (event.critical) node.critical = true;
    // Questions are aids for the reviewer. They never move a level.
    for (const q of event.questions ?? []) node.questions.push({ text: q.text, why: q.why, changes: q.changes, by: event.by ?? "risk-level" });
    if (event.suggest && LEVELS.includes(event.suggest.to)) extra.push({ kind: event.suggest.kind ?? "restructure", at: { node: node.id, line: event.lines?.[0] }, text: event.suggest.text, to: event.suggest.to, by: event.by ?? "risk-level" });
    node.reviewed = true;
  }
  // Rebuild suggestions against the levels the events produced, keeping floors and findings.
  const keep = new Map(graph.nodes.filter((n) => n.level).map((n) => [n.id, { level: n.level, findings: [...n.findings], critical: n.critical, questions: n.questions }]));
  assess(graph, config);
  for (const node of graph.nodes) {
    const prior = keep.get(node.id);
    if (!prior) continue;
    node.findings = prior.findings;
    node.critical = prior.critical;
    node.questions = prior.questions;
    node.level = { floor: prior.level.floor, current: prior.level.current, why: prior.level.why, if: node.level.if };
  }
  for (const item of extra) {
    const node = byId.get(item.at.node);
    const id = `s${graph.suggestions.length + 1}`;
    graph.suggestions.push({ id, kind: item.kind, at: item.at, text: item.text, by: item.by, moves: [{ node: node.id, from: node.level.current, to: item.to }] });
    node.level.if.push({ suggestion: id, level: item.to });
  }
  summarize(graph);
  graph.revision = 2;
  graph.events_applied = events.length - rejected.length;
  graph.rejected_events = rejected;
  return graph;
}

// ---------- cli ----------

const [command, ...rest] = process.argv.slice(2);
const options = args(rest);
let result;
if (command === "build" && options._[0]) result = build(options._[0], options);
else if (command === "apply" && options._[1]) result = apply(options._[0], options._[1], options);
else {
  process.stderr.write("usage: review-graph.mjs build <pack.json> [--repo dir] [--config file] [--out file]\n       review-graph.mjs apply <graph.json> <events.jsonl> [--out file]\n");
  process.exit(2);
}
const text = `${JSON.stringify(result, null, 1)}\n`;
if (options.out) writeFileSync(options.out, text);
else process.stdout.write(text);
if (result.rejected_events?.length) process.stderr.write(`${result.rejected_events.length} event(s) rejected; see rejected_events\n`);
