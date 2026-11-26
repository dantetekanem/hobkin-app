/**
 * TLC's printed values as the window's `TlaValue`, so it draws them without parsing TLA+. The shapes are the ones TLC's
 * values print in (tlc2/value/impl at v1.7.4): `"text"` (StringValue, with \" and \\ escaped), numbers, TRUE and FALSE,
 * bare model values, `{a, b}` (SetEnumValue), `<<a, b>>` and `<< >>` (TupleValue, and a function on 1..n),
 * `[f |-> v]` (RecordValue) and `(k :> v @@ k2 :> v2)` (FcnRcdValue on any other domain). Anything else, such as
 * `1..3` or `[S -> T]`, stays as its text.
 */

const TOKEN = /\s*(?:("(?:[^"\\]|\\.)*")|(-?\d+)|(<<|>>|\|->|:>|@@|\.\.|[{}[\](),])|([A-Za-z_][A-Za-z0-9_]*))/y;

function tokens(text) {
  const found = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const start = TOKEN.lastIndex;
    const match = TOKEN.exec(text);
    if (!match) {
      if (!text.slice(start).trim()) break;
      return null;
    }
    const [whole, string, number, symbol, word] = match;
    const at = start + whole.length - whole.trimStart().length;
    found.push({ string, number, symbol, word, start: at, end: TOKEN.lastIndex });
  }
  return found;
}

const unquote = text => text.slice(1, -1).replace(/\\(.)/g, (_, escaped) => (escaped === 'n' ? '\n' : escaped));

/** A recursive descent over the tokens. It throws on anything outside the shapes above, and the caller keeps the text. */
function parser(text, list) {
  let at = 0;
  const peek = () => list[at];
  const take = symbol => {
    if (peek()?.symbol !== symbol) throw Error(`Expected ${symbol}`);
    return list[at++];
  };
  const items = close => {
    const values = [];
    if (peek()?.symbol === close) {
      at++;
      return values;
    }
    for (;;) {
      values.push(value());
      if (peek()?.symbol === close) {
        at++;
        return values;
      }
      take(',');
    }
  };
  const value = () => {
    const token = list[at++];
    if (!token) throw Error('Unexpected end');
    if (token.string !== undefined) return { kind: 'string', text: unquote(token.string) };
    if (token.number !== undefined) return { kind: 'number', text: token.number };
    if (token.word === 'TRUE' || token.word === 'FALSE') return { kind: 'boolean', text: token.word };
    if (token.word !== undefined) return { kind: 'model', text: token.word };
    if (token.symbol === '{') return { kind: 'set', items: items('}') };
    if (token.symbol === '<<') return { kind: 'sequence', items: items('>>') };
    if (token.symbol === '[') {
      const pairs = [];
      for (;;) {
        const key = list[at++];
        if (key?.word === undefined) throw Error('Expected a field');
        take('|->');
        pairs.push({ key: key.word, value: value() });
        if (peek()?.symbol === ']') {
          at++;
          return { kind: 'record', pairs };
        }
        take(',');
      }
    }
    if (token.symbol === '(') {
      const pairs = [];
      for (;;) {
        const from = peek()?.start;
        value();
        const key = text.slice(from, list[at - 1].end).replace(/\s+/g, ' ');
        take(':>');
        pairs.push({ key, value: value() });
        if (peek()?.symbol === ')') {
          at++;
          return { kind: 'function', pairs };
        }
        take('@@');
      }
    }
    throw Error(`Unexpected ${token.symbol}`);
  };
  return {
    whole() {
      const result = value();
      if (at !== list.length) throw Error('Text left over');
      return result;
    },
  };
}

export function parseValue(text) {
  const raw = { kind: 'raw', text: text.trim() };
  const list = tokens(text);
  if (!list?.length) return raw;
  try {
    return parser(text, list).whole();
  } catch {
    return raw;
  }
}

/** A state as TLC prints it: `/\ name = value` lines, a value going on over the lines after it, or `name = value` alone. */
export function parseState(text) {
  const blocks = [];
  for (const line of text.replace(/\s+$/, '').split('\n')) {
    if (line.startsWith('/\\ ')) blocks.push(line.slice(3));
    else if (blocks.length) blocks[blocks.length - 1] += `\n${line}`;
    else if (line.trim()) blocks.push(line);
  }
  return blocks.flatMap(block => {
    const at = block.indexOf(' = ');
    return at === -1 ? [] : [{ name: block.slice(0, at).trim(), value: parseValue(block.slice(at + 3)) }];
  });
}

/** A dot label as DotStateWriter escapes it: backslashes doubled, quotes escaped and new lines as \n. */
function unescapeLabel(text) {
  let out = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = text[++index];
    out += next === 'n' ? '\n' : next ?? '';
  }
  return out;
}

const NODE = /^(-?\d+) \[label="((?:[^"\\]|\\.)*)"(,style = filled)?\];?$/;
const EDGE = /^(-?\d+) -> (-?\d+)(?: \[(.*)\])?;$/;

/**
 * The state graph from `-dump dot,actionlabels,colorize` (tlc2/util/DotStateWriter at v1.7.4): each state by its
 * fingerprint, with `style = filled` on the initial ones, and each move labeled with its action. The legend after the
 * graph is left out. `total` is how many distinct states the whole model has.
 */
export function parseDot(text, total) {
  const nodes = new Map();
  const edges = new Map();
  const graph = text.split(/^subgraph cluster_legend/m)[0];
  for (const line of graph.split('\n')) {
    const edge = line.match(EDGE);
    if (edge) {
      const action = edge[3]?.match(/label="([^"]*)"/)?.[1] ?? '';
      edges.set(`${edge[1]} ${edge[2]} ${action}`, { from: edge[1], to: edge[2], action });
      continue;
    }
    const node = line.match(NODE);
    if (node && !nodes.has(node[1])) nodes.set(node[1], { id: node[1], initial: Boolean(node[3]), vars: parseState(unescapeLabel(node[2])) });
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], total: total ?? nodes.size };
}
