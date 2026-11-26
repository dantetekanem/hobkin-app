import { basename } from 'node:path';

/**
 * What SANY (`java -cp tla2tools.jar tla2sany.SANY <spec>`) printed: whether the spec parsed, and where it did not. The
 * formats are from tla2sany at v1.7.4: a parse error from TLAplusParser and ParseException ("Encountered ... at line L,
 * column C"), a lexical one from TokenMgrError ("Lexical error at line L, column C."), and a semantic one from
 * semantic/Errors with st/Location ("line L, col C to line L2, col C2 of module M" and the message after a blank line).
 * SANY exits with -1 on any of them.
 */
export function readSany(text, exitCode) {
  const lines = text.split('\n');
  const parsedFiles = upTo => lines.slice(0, upTo).map(line => line.match(/^Parsing file (.+)$/)?.[1]).filter(Boolean);
  const files = parsedFiles(lines.length);
  const fileOf = module => files.find(file => basename(file) === `${module}.tla`) ?? files[0] ?? null;

  const parse = lines.findIndex(line => /^(Encountered .* at line \d+, column \d+|Lexical error at line \d+, column \d+)/.test(line));
  if (parse !== -1) {
    const [, line, column] = lines[parse].match(/at line (\d+), column (\d+)/);
    // The error is in the file SANY was parsing when it stopped.
    return { ok: false, file: parsedFiles(parse).at(-1) ?? null, line: Number(line), column: Number(column), message: lines[parse].trim() };
  }

  const semantic = lines.findIndex(line => /^line \d+, col \d+ to line \d+, col \d+ of module \w+/.test(line));
  if (semantic !== -1) {
    const [, line, column, module] = lines[semantic].match(/^line (\d+), col (\d+) to line \d+, col \d+ of module (\w+)/);
    const message = lines.slice(semantic + 1).find(line => line.trim())?.trim() ?? 'Semantic error.';
    return { ok: false, file: fileOf(module), line: Number(line), column: Number(column), message };
  }

  if (exitCode !== 0) {
    const said = lines.filter(line => line.trim() && !/^\*{6} SANY2|^Parsing file|^Semantic processing/.test(line)).join(' ').trim();
    return { ok: false, file: files[0] ?? null, line: null, column: null, message: said || `SANY exited with ${exitCode}.` };
  }
  return { ok: true };
}
