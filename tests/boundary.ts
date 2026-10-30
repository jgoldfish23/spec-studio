import { dirname, isAbsolute, relative, resolve } from "node:path";

/** Absolute path of `src/engine`, independent of the current working directory. */
const ENGINE_ROOT = resolve(import.meta.dirname, "../src/engine");

/** Module specifiers: `from "x"`, `import("x")`, and side-effect `import "x"`. */
const SPECIFIER_PATTERNS: RegExp[] = [
  /\bfrom\s*(["'])([^"'\n]+)\1/g,
  /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
  /\bimport\s+(["'])([^"'\n]+)\1/g,
];

/** Sources of nondeterminism banned from non-test engine files. */
const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bDate\.now\s*\(/g, label: "Date.now(" },
  { pattern: /\bnew\s+Date\s*\(\s*\)/g, label: "new Date()" },
  { pattern: /\bMath\.random\s*\(/g, label: "Math.random(" },
];

const isTestLike = (filePath: string): boolean =>
  filePath.endsWith(".test.ts") || filePath.split(/[\\/]/).includes("__fixtures__");

const isPathSpecifier = (spec: string): boolean => spec.startsWith(".") || isAbsolute(spec);

const isInsideEngine = (absPath: string): boolean => {
  const rel = relative(ENGINE_ROOT, absPath);
  return !rel.startsWith("..") && !isAbsolute(rel);
};

const isZod = (spec: string): boolean => spec === "zod" || spec.startsWith("zod/");

const isTestOnlyPackage = (spec: string): boolean =>
  spec === "vitest" || spec === "fast-check" || spec.startsWith("node:");

const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length;

/**
 * Checks one engine source file against the engine boundary rules and returns
 * a violation message per offence (empty array when the file is clean).
 *
 * - Imports may only be relative paths that stay inside `src/engine/`, or `zod`.
 * - Test-like files (`*.test.ts`, anything under `__fixtures__/`) may also import
 *   `vitest`, `fast-check` and `node:*`, and may use the clock and randomness.
 * - Non-test-like files must not use `Date.now(`, `new Date()` or `Math.random(`.
 */
export function checkEngineSource(filePath: string, source: string): string[] {
  const testLike = isTestLike(filePath);
  const violations: string[] = [];

  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[2];
      if (spec === undefined) continue;
      const where = `${filePath}:${lineOf(source, match.index)}`;
      if (isPathSpecifier(spec)) {
        if (!isInsideEngine(resolve(dirname(filePath), spec))) {
          violations.push(`${where}: import "${spec}" resolves outside src/engine`);
        }
      } else if (!isZod(spec) && !(testLike && isTestOnlyPackage(spec))) {
        violations.push(`${where}: import "${spec}" is not allowed in the engine`);
      }
    }
  }

  if (!testLike) {
    for (const { pattern, label } of FORBIDDEN_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        violations.push(`${filePath}:${lineOf(source, match.index)}: ${label} is not allowed in engine code`);
      }
    }
  }

  return violations;
}
