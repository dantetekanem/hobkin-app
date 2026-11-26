/**
 * TLC's `-tool` output. Each message is framed, from tlc2/output/MP.java:
 *
 *   @!@!@STARTMSG <code>:<class> @!@!@
 *   <text>
 *   @!@!@ENDMSG <code> @!@!@
 *
 * The class is 0 for none, 1 for an error, 2 for a TLC bug, 3 for a warning and 4 for a state. Lines outside a frame,
 * such as SANY's "Parsing file" lines, come through as messages with no code. The codes and the text each one carries
 * are from tlc2/output/EC.java and MP.java at v1.7.4: https://github.com/tlaplus/tlaplus/tree/v1.7.4/tlatools/org.lamport.tlatools/src/tlc2/output
 */

const START = /^@!@!@STARTMSG (\d+):(\d+) @!@!@$/;
const END = /^@!@!@ENDMSG (\d+) @!@!@$/;

/** Feeds `onMessage` each whole message from text that comes in chunks of any size. */
export function messageReader(onMessage) {
  let pending = '';
  let open = null;

  const line = text => {
    const started = text.match(START);
    if (started && !open) {
      open = { code: Number(started[1]), cls: Number(started[2]), lines: [] };
      return;
    }
    const ended = open && text.match(END);
    if (ended && Number(ended[1]) === open.code) {
      onMessage({ code: open.code, cls: open.cls, text: open.lines.join('\n') });
      open = null;
      return;
    }
    if (open) open.lines.push(text);
    else if (text.trim()) onMessage({ code: null, cls: null, text });
  };

  return {
    push(chunk) {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const text of lines) line(text.replace(/\r$/, ''));
    },
    end() {
      if (pending) line(pending);
      pending = '';
      // A message the process never closed, because it was killed, is still what it said.
      if (open) onMessage({ code: open.code, cls: open.cls, text: open.lines.join('\n') });
      open = null;
    },
  };
}

/** TLC groups digits by the JVM's locale ("1,234,567"), and its counts are whole numbers. */
const count = text => Number(String(text).replace(/\D/g, ''));

/** `<Fix line 37, col 8 to line 40, col 39 of module WorkItem>`, `<Next line 49, ... of module X (49 9 49 14)>` or `<Initial predicate>`. */
function location(text) {
  if (/^<Initial predicate>/.test(text)) return { action: 'Init', line: null };
  const found = text.match(/^<(\S+) line (\d+), col \d+ to line \d+, col \d+ of module \w+/);
  return found ? { action: found[1], line: Number(found[2]) } : { action: text.replace(/^<|>$/g, '').trim(), line: null };
}

const firstLine = text => text.split('\n')[0];
const afterFirstLine = text => text.slice(text.indexOf('\n') + 1);

const PROGRESS = /^Progress\((\d+)\) at [^:]+:\d+:\d+: ([\d,.\s  ']+) states generated.*?, ([\d,.\s  ']+) distinct states found.*?, ([\d,.\s  ']+) states left on queue/;
const STATS = /^([\d,.\s  ']+) states generated, ([\d,.\s  ']+) distinct states found, ([\d,.\s  ']+) states left on queue/;

/** What one message means, as a plain object. Messages hobkin does not use come back as `other`. */
export function readMessage({ code, cls, text }) {
  switch (code) {
    case 2200: {
      const found = text.match(PROGRESS);
      if (found) return { kind: 'progress', depth: count(found[1]), generated: count(found[2]), distinct: count(found[3]), queue: count(found[4]) };
      break;
    }
    case 2199: {
      const found = text.match(STATS);
      if (found) return { kind: 'stats', generated: count(found[1]), distinct: count(found[2]), queue: count(found[3]) };
      break;
    }
    case 2194: return { kind: 'depth', depth: count(text) };
    case 2186: return { kind: 'finished', ms: count(text.match(/Finished in (\d+)ms/)?.[1] ?? 0) };
    case 2193: return { kind: 'success' };
    case 2107:
    case 2108: {
      const found = text.match(/^(?:Invariant|Property) (\S+) is violated by the initial state:/);
      return { kind: 'violation', rule: found?.[1] ?? null, ruleKind: code === 2107 ? 'invariant' : 'property', state: afterFirstLine(text) };
    }
    case 2110: return { kind: 'violation', rule: text.match(/^Invariant (\S+) is violated/)?.[1] ?? null, ruleKind: 'invariant' };
    case 2112: return { kind: 'violation', rule: text.match(/^Action property (\S+) is violated/)?.[1] ?? null, ruleKind: 'property' };
    case 2114: return { kind: 'violation', rule: null, ruleKind: 'deadlock' };
    // TLC does not say which temporal property broke.
    case 2116: return { kind: 'violation', rule: null, ruleKind: 'property' };
    // EC.java maps 2146 to an evaluation failure: the invariant has primes or temporal operators. Nothing broke.
    case 2146: return { kind: 'error', rule: text.match(/^The invariant (\S+) is not a state predicate/)?.[1] ?? null, text: firstLine(text) };
    case 2120:
    case 2121:
    case 2264: return { kind: 'trace' };
    case 2216:
    case 2217: {
      const found = firstLine(text).match(/^(\d+):\s?(.*)$/);
      if (!found) break;
      return { kind: 'state', n: Number(found[1]), ...location(found[2]), text: afterFirstLine(text) };
    }
    case 2218: return { kind: 'stuttering', n: count(firstLine(text).split(':')[0]) };
    case 2122: {
      const found = firstLine(text).match(/^(\d+): Back to state(?:: (.*))?$/);
      if (found) return { kind: 'back', n: Number(found[1]), action: found[2] ? location(found[2]).action : null };
      break;
    }
    case 2201: return { kind: 'coverage-start' };
    case 2772: {
      const found = text.match(/^<(\S+) .*>: (\d+):(\d+)$/);
      if (found) return { kind: 'coverage', name: found[1], distinct: Number(found[2]), found: Number(found[3]) };
      break;
    }
    case 2202:
    case 2777: return { kind: 'coverage-end' };
    case 2262: return { kind: 'version', text };
  }
  // An error or a TLC bug that hobkin has no word for still ends the run as an error, in TLC's own words.
  if (cls === 1 || cls === 2) return { kind: 'error', rule: null, text: text.trim() };
  if (cls === 3) return { kind: 'warning', text: text.trim() };
  return { kind: 'other', code, text };
}
