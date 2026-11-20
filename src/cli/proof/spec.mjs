/**
 * What hobkin reads from a TLA+ spec and its cfg for the run and the math view: the files it models, its top-level
 * definitions in Unicode with each one's `\* words:` and `\* code:` comments, what the cfg says must stay true, and the
 * model's size.
 */

/*
 * ASCII to Unicode, from tlauc's symbol table (resources/tla-unicode.csv, https://github.com/tlaplus-community/tlauc,
 * MIT License, Copyright (c) Andrew Helwer). The prime and the module's rule lines are hobkin's own additions: the table
 * leaves them as typed.
 */
const SYMBOLS = [
  ['-+->', '⇸'], ['<=>', '⇔'], ['|->', '↦'], ['...', '…'], ['(\\X)', '⊗'], ['(+)', '⊕'], ['(-)', '⊖'], ['(.)', '⊙'],
  ['(/)', '⊘'], ['==', '≜'], ['<-', '←'], ['->', '→'], ['<<', '⟨'], ['>>', '⟩'], ['[]', '□'], ['<>', '◇'], ['=>', '⇒'],
  ['~>', '↝'], ['/\\', '∧'], ['\\/', '∨'], [':=', '≔'], ['/=', '≠'], ['<=', '≤'], ['=<', '≤'], ['>=', '≥'], ['|-', '⊢'],
  ['|=', '⊨'], ['-|', '⊣'], ['=|', '⫤'], ['..', '‥'], ['!!', '‼'], ['??', '⁇'], ['^+', '⁺'], ['::', '∷'], ['||', '‖'],
  ['#', '≠'], ['~', '¬'], ["'", '′'],
];
const WORDS = {
  '\\in': '∈', '\\notin': '∉', '\\A': '∀', '\\forall': '∀', '\\E': '∃', '\\exists': '∃', '\\lnot': '¬', '\\neg': '¬',
  '\\land': '∧', '\\lor': '∨', '\\equiv': '≡', '\\approx': '≈', '\\asymp': '≍', '\\cong': '≅', '\\doteq': '≐',
  '\\gg': '≫', '\\ll': '≪', '\\prec': '≺', '\\succ': '≻', '\\preceq': '⪯', '\\succeq': '⪰', '\\propto': '∝',
  '\\sim': '∼', '\\simeq': '≃', '\\sqsubset': '⊏', '\\sqsupset': '⊐', '\\sqsubseteq': '⊑', '\\sqsupseteq': '⊒',
  '\\subset': '⊂', '\\supset': '⊃', '\\subseteq': '⊆', '\\supseteq': '⊇', '\\intersect': '∩', '\\cap': '∩',
  '\\union': '∪', '\\cup': '∪', '\\oplus': '⊕', '\\ominus': '⊖', '\\odot': '⊙', '\\oslash': '⊘', '\\otimes': '⊗',
  '\\bigcirc': '◯', '\\bullet': '●', '\\div': '÷', '\\o': '∘', '\\circ': '∘', '\\star': '⋆', '\\sqcap': '⊓',
  '\\sqcup': '⊔', '\\uplus': '⊎', '\\X': '×', '\\times': '×', '\\wr': '≀', '\\cdot': '⋅', '\\leq': '≤', '\\geq': '≥',
  Nat: 'ℕ', Int: 'ℤ', Real: 'ℝ',
};

/** One line in Unicode, and where each of its source columns lands, so the lines under it can keep their alignment. */
function convert(line) {
  const columns = new Map();
  let out = '';
  let at = 0;
  const copy = length => {
    out += line.slice(at, at + length);
    at += length;
  };
  while (at < line.length) {
    columns.set(at, out.length);
    const rest = line.slice(at);
    if (rest.startsWith('\\*')) {
      copy(rest.length);
      break;
    }
    if (rest[0] === '"') {
      const string = rest.match(/^"(?:[^"\\]|\\.)*"?/)[0];
      copy(string.length);
      continue;
    }
    if (rest.startsWith('(*')) {
      const end = rest.indexOf('*)');
      copy(end === -1 ? rest.length : end + 2);
      continue;
    }
    const word = rest.match(/^\\?[A-Za-z0-9_]+/)?.[0];
    const unicode = word && Object.hasOwn(WORDS, word) ? WORDS[word] : null;
    if (unicode) {
      out += unicode;
      at += word.length;
      continue;
    }
    if (word && word[0] !== '\\') {
      copy(word.length);
      continue;
    }
    // `=<<` is `=` before a tuple, never `=<` before `<`.
    const symbol = SYMBOLS.find(([ascii]) => rest.startsWith(ascii) && !(ascii === '=<' && rest[2] === '<'));
    if (symbol) {
      out += symbol[1];
      at += symbol[0].length;
    } else copy(1);
  }
  columns.set(at, out.length);
  return { text: out, columns };
}

export const toUnicode = line => convert(line).text;

/** Lines in Unicode, each indented to land under the column it lined up with before the symbols got shorter. */
function convertBlock(lines) {
  const done = [];
  for (const line of lines) {
    const indent = line.match(/^ */)[0].length;
    // The line above whose text starts where this one does, such as the first /\ of a conjunction list.
    const anchor = indent > 0 ? done.findLast(({ source }) => source[indent] && source[indent] !== ' ') : undefined;
    const to = anchor?.columns.get(indent) ?? indent;
    const { text, columns } = convert(line.slice(indent));
    done.push({
      source: line,
      text: ' '.repeat(to) + text,
      columns: new Map([...columns].map(([from, landed]) => [from + indent, landed + to])),
    });
  }
  return done.map(({ text }) => text);
}

const DECLARATION = /^(EXTENDS|CONSTANTS?|VARIABLES?|RECURSIVE|ASSUME|ASSUMPTION|AXIOM|INSTANCE|LOCAL\s+INSTANCE)\b/;
const THEOREM = /^(?:THEOREM|LEMMA|PROPOSITION|COROLLARY)\b\s*(?:([A-Za-z_]\w*)\s*==)?/;
const DEFINITION = /^(?:LOCAL\s+)?([A-Za-z_]\w*)\s*(?:\([^)]*\)|\[[^\]]*\])?\s*==/;
const COMMENT = /^\s*\\\*\s?(.*)$/;

/** The name of the definition or theorem a top-level line starts, or null when it starts neither. */
function itemName(line, lineNumber) {
  const theorem = line.match(THEOREM);
  if (theorem) return theorem[1] ?? `THEOREM line ${lineNumber}`;
  return line.match(DEFINITION)?.[1] ?? null;
}

/** A comment's `words:` or `code:`, onto the definition it belongs to. */
function note(item, comment) {
  const found = comment.match(/^(words|code):\s*(.+)$/);
  if (found && item) item[found[1]] ??= found[2].trim();
}

/**
 * The spec's parts for the math view. A top-level item starts at column 0: the module's own lines (its header and
 * declarations), each definition, and each theorem with its proof. A run of `\*` comments right above an item, or inside
 * it, gives its words and code.
 */
export function readSpec(text) {
  const lines = text.split('\n');
  const items = [];
  const models = [];
  let module = null;
  let current = null;
  let pending = [];

  const begin = (item, comments) => {
    for (const comment of comments) note(item, comment);
    current = item;
  };
  for (const [index, line] of lines.entries()) {
    const comment = line.match(COMMENT)?.[1];
    const modeled = comment?.match(/^models:\s*(.+)$/)?.[1];
    if (modeled) models.push(...modeled.split(',').map(path => path.trim()).filter(Boolean));

    const header = line.match(/^-{4,}\s*MODULE\s+(\w+)\s*-{4,}/);
    if (header && !module) {
      module = { name: header[1], line: index + 1, source: [line.replace(/-{4,}/g, '────').trim()] };
      items.push(module);
      begin(module, []);
      continue;
    }
    if (/^={4,}/.test(line)) break;
    if (!line.trim()) {
      pending = [];
      continue;
    }
    if (comment !== undefined) {
      if (/^\\\*/.test(line)) pending.push(comment);
      else note(current, comment);
      continue;
    }
    if (/^\s/.test(line)) {
      current?.source.push(line);
      continue;
    }
    const name = itemName(line, index + 1);
    if (name) {
      const item = { name, line: index + 1, source: [line] };
      items.push(item);
      begin(item, pending);
    } else if (DECLARATION.test(line) && module) {
      module.source.push(line);
      begin(module, pending);
    } else current?.source.push(line);
    pending = [];
  }

  const definitions = items.map(({ name, line, source, words, code }) => ({
    name,
    line,
    lines: convertBlock(source),
    ...(words ? { words } : {}),
    ...(code ? { code } : {}),
  }));
  return { module: module?.name ?? null, models, definitions, hasProof: hasProof(text) };
}

/** A theorem with a proof under it: a BY, OBVIOUS or OMITTED, a PROOF, or numbered steps. */
export const hasProof = text => /^(?:THEOREM|LEMMA|PROPOSITION|COROLLARY)\b/m.test(text) && /\b(?:BY|OBVIOUS|OMITTED|PROOF)\b|^\s*<\d+>/m.test(text);

const CFG_KEYWORDS = /\b(CONSTANTS?|INIT|NEXT|SPECIFICATION|INVARIANTS?|PROPERTY|PROPERTIES|CONSTRAINTS?|ACTION_CONSTRAINTS?|SYMMETRY|VIEW|CHECK_DEADLOCK|ALIAS|POSTCONDITION|TYPE_CONSTRAINT|TYPE)\b/g;

/** The parts of a TLC cfg a run reports: what must stay true, the constants and whether deadlock counts as a failure. */
export function readCfg(text) {
  const bare = text.replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\\\*.*$/gm, ' ');
  // Each keyword owns the text up to the next one.
  const found = [...bare.matchAll(CFG_KEYWORDS)];
  const sections = found.map((match, index) => ({
    keyword: match[1],
    body: bare.slice(match.index + match[0].length, found[index + 1]?.index ?? bare.length),
  }));

  const bodies = pattern => sections.filter(({ keyword }) => pattern.test(keyword)).map(({ body }) => body);
  const names = pattern => bodies(pattern).flatMap(body => body.split(/\s+/).filter(Boolean));
  // `Name = value` or `Name <- Other`, where a value can be a set with spaces in it.
  const assignments = body => [...body.matchAll(/([A-Za-z_]\w*)\s*(?:=|<-)\s*(\{[^}]*\}|\S+)/g)];
  const constants = bodies(/^CONSTANTS?$/).flatMap(assignments).map(([, name, value]) => ({ name, value: value.replace(/\s+/g, ' ') }));
  const deadlock = names(/^CHECK_DEADLOCK$/)[0];
  return {
    invariants: names(/^INVARIANTS?$/),
    properties: names(/^PROPERT(Y|IES)$/),
    constants,
    checkDeadlock: deadlock !== 'FALSE',
  };
}

/** The model's size in a line, from the cfg's constants: "Items = {i1, i2}, MaxPush = 3". */
export const modelLine = cfg => (cfg.constants.length ? cfg.constants.map(({ name, value }) => `${name} = ${value}`).join(', ') : undefined);
