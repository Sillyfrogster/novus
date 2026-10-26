// Biome's noEmptyBlockStatements ignores blocks that hold only a comment, so this
// text check covers that gap. It blanks comments and string contents, then flags
// catch blocks and promise .catch arrows whose body is left with no code.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SCAN_ROOTS = ["src", "tests"];

/** Replace comments and string or template contents with spaces, keeping newlines. */
function blankNonCode(source: string): string {
  const out: string[] = [];
  let i = 0;
  const keep = (ch: string) => (ch === "\n" ? "\n" : " ");
  // charAt returns "" past the end, so the bounds checks below stay simple.
  while (i < source.length) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);
    if (ch === "/" && next === "/") {
      while (i < source.length && source.charAt(i) !== "\n") out.push(keep(source.charAt(i++)));
    } else if (ch === "/" && next === "*") {
      out.push("  ");
      i += 2;
      while (i < source.length && !(source.charAt(i) === "*" && source.charAt(i + 1) === "/")) {
        out.push(keep(source.charAt(i++)));
      }
      if (i < source.length) {
        out.push("  ");
        i += 2;
      }
    } else if (ch === '"' || ch === "'" || ch === "`") {
      out.push(ch);
      i += 1;
      while (i < source.length && source.charAt(i) !== ch) {
        if (source.charAt(i) === "\\") {
          out.push(keep(source.charAt(i++)));
        }
        if (i < source.length) out.push(keep(source.charAt(i++)));
      }
      if (i < source.length) {
        out.push(ch);
        i += 1;
      }
    } else {
      out.push(ch);
      i += 1;
    }
  }
  return out.join("");
}

/** Index just past the brace that closes the block opened at `open`, or -1. */
function closingBrace(blanked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    if (blanked[i] === "{") depth += 1;
    else if (blanked[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source[i] === "\n") line += 1;
  return line;
}

const CATCH_BLOCK = /(?<![.\w$])catch\s*(?:\([^()]*\)\s*)?\{/g;
const PROMISE_CATCH_ARROW =
  /\.catch\s*\(\s*(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g;

/** Return the 1-based line numbers of catch blocks whose body holds no code. */
export function findEmptyCatchBlocks(source: string): number[] {
  const blanked = blankNonCode(source);
  const lines = new Set<number>();
  for (const pattern of [CATCH_BLOCK, PROMISE_CATCH_ARROW]) {
    pattern.lastIndex = 0;
    for (const match of blanked.matchAll(pattern)) {
      const open = (match.index ?? 0) + match[0].length - 1;
      const close = closingBrace(blanked, open);
      if (close < 0) continue;
      const body = blanked.slice(open + 1, close);
      if (body.trim() === "") lines.add(lineOf(source, match.index ?? 0));
    }
  }
  return [...lines].sort((a, b) => a - b);
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) found.push(path);
  }
  return found;
}

function main(): number {
  let findings = 0;
  for (const root of SCAN_ROOTS) {
    for (const file of sourceFiles(join(process.cwd(), root))) {
      const source = readFileSync(file, "utf8");
      for (const line of findEmptyCatchBlocks(source)) {
        console.log(`${relative(process.cwd(), file)}:${line}: empty catch block`);
        findings += 1;
      }
    }
  }
  return findings === 0 ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (error) {
    console.error("check-empty-catch: crashed", error);
    process.exit(2);
  }
}
