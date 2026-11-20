import { toUnicode } from './spec.mjs';

/**
 * TLAPS through `tlapm --toolbox 0 0 --strict` (_specs/050-tla-proofs). In toolbox mode tlapm writes its messages to
 * stderr, each between `@!!BEGIN` and `@!!END`, one `@!!field:value` a line, from tlapm's src/toolbox_msg.ml
 * (https://github.com/tlaplus/tlapm). An obligation message carries its id, `loc` (line:col:line:col), status, prover,
 * `meth` with the time it used, and for a failed one `obl`, the sequent it had to prove. Without `--strict` tlapm can
 * report every obligation proved while steps have no proof at all, so hobkin always passes it, and only an exit of 0
 * under it means the proof holds. `--strict` lists those steps as "Missing proof at" and "Omitted proof at" lines.
 */

export const tlapmArguments = (spec, cacheDir) => ['--toolbox', '0', '0', '--strict', '--cache-dir', cacheDir, spec];

const ABSENT = /\[ERROR\]: (Missing|Omitted) proof at File "([^"]*)", line (\d+), character/;

/** The toolbox messages, in order, as objects of their fields, with the steps `--strict` found missing or omitted. */
export function readToolbox(text) {
  const blocks = [];
  let open = null;
  let last = null;
  for (const line of text.split('\n')) {
    if (line === '@!!BEGIN') {
      open = {};
      last = null;
      continue;
    }
    if (line === '@!!END') {
      if (open) blocks.push(open);
      open = null;
      continue;
    }
    if (open) {
      const field = line.match(/^@!!([a-z]+):(.*)$/);
      if (field) {
        last = field[1];
        open[last] = field[2];
      } else if (last) open[last] += `\n${line}`;
      continue;
    }
    const absent = line.match(ABSENT);
    if (absent) blocks.push({ type: absent[1].toLowerCase(), file: absent[2], line: Number(absent[3]) });
  }
  return blocks;
}

const STATUS = { proved: 'proved', trivial: 'proved', failed: 'failed', interrupted: 'failed', 'to be proved': 'pending', 'being proved': 'pending' };

/** The step a line of the source belongs to: its `<n>label`, or the theorem it is in when it has no steps. */
function stepAt(lines, line) {
  for (let at = line - 1; at >= 0; at--) {
    const text = lines[at] ?? '';
    const step = text.match(/^\s*(<(\d+)>[A-Za-z0-9_]*)\.?\s*(.*)$/);
    if (step) return { id: step[1], depth: Number(step[2]), label: toUnicode(step[3].trim()) || step[1] };
    const theorem = text.match(/^(?:THEOREM|LEMMA|PROPOSITION|COROLLARY)\s+(?:([A-Za-z_]\w*)\s*==\s*)?(.*)$/);
    if (theorem) return { id: theorem[1] ?? `line ${at + 1}`, depth: 0, label: toUnicode(theorem[2].trim()) };
  }
  return { id: `line ${line}`, depth: 0, label: '' };
}

/** Splits at the commas between hypotheses, not those inside brackets. */
function topLevel(text) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < text.length; at++) {
    const two = text.slice(at, at + 2);
    if (two === '<<' || two === '>>') {
      depth += two === '<<' ? 1 : -1;
      at++;
    } else if ('([{'.includes(text[at])) depth++;
    else if (')]}'.includes(text[at])) depth--;
    else if (text[at] === ',' && depth === 0) {
      parts.push(text.slice(from, at));
      from = at + 1;
    }
  }
  parts.push(text.slice(from));
  return parts.map(part => toUnicode(part.replace(/\s+/g, ' ').trim())).filter(Boolean);
}

/** A failed obligation's sequent, `ASSUME h1, h2 PROVE g`: what it had to show and what it knew. */
function sequent(obl) {
  const found = obl.match(/^\s*ASSUME\s+([\s\S]*?)\s*PROVE\s+([\s\S]*)$/);
  if (!found) return { goal: toUnicode(obl.replace(/\s+/g, ' ').trim()), known: [] };
  return { goal: toUnicode(found[2].replace(/\s+/g, ' ').trim()), known: topLevel(found[1]) };
}

const seconds = meth => {
  const used = meth?.match(/time-used: ([\d.]+)/)?.[1];
  return used === undefined ? undefined : Number(used);
};

/**
 * The proof as the math view's tree draws it: one entry for each step, in the source's order, with the last status tlapm
 * gave it. `proved` is the proof as a whole, and it holds only under `--strict` with an exit of 0.
 */
export function proofFrom(blocks, { source, exitCode, strict }) {
  const lines = source.split('\n');
  const latest = new Map();
  for (const block of blocks) if (block.type === 'obligation' && block.id) latest.set(block.id, block);

  const steps = [...latest.values()].map(block => {
    const [line, column] = (block.loc ?? '').split(':').map(Number);
    const step = stepAt(lines, line);
    const status = STATUS[block.status] ?? 'pending';
    const entry = { id: step.id, label: step.label, status, depth: step.depth };
    if (block.prover) entry.backend = block.prover;
    const used = seconds(block.meth);
    if (used !== undefined) entry.seconds = used;
    if (status === 'failed' && block.obl) Object.assign(entry, sequent(block.obl));
    return { line, column: column || 0, entry };
  });
  for (const block of blocks.filter(({ type }) => type === 'missing' || type === 'omitted')) {
    const step = stepAt(lines, block.line);
    steps.push({ line: block.line, column: 0, entry: { id: step.id, label: step.label, status: block.type, depth: step.depth } });
  }

  const obligations = steps.sort((a, b) => a.line - b.line || a.column - b.column).map(({ entry }) => entry);
  // tlapm exits 0 after a fatal error too, so a proof with no steps proved proves nothing.
  const proved = strict === true && exitCode === 0 && obligations.length > 0 && obligations.every(({ status }) => status === 'proved');
  return { strict: strict === true, proved, exitCode, obligations };
}
