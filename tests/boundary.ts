import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Absolute path of the repository root, independent of the current working directory. */
const REPO_ROOT = resolve(import.meta.dirname, "..");
/** Absolute path of `src/`. */
const SRC_ROOT = join(REPO_ROOT, "src");
/** Absolute path of `src/engine`. */
const ENGINE_ROOT = join(SRC_ROOT, "engine");
/** Absolute path of `src/engine/__fixtures__`, the only part of the engine that test files may reach into. */
const ENGINE_FIXTURES_ROOT = join(ENGINE_ROOT, "__fixtures__");
/** The one non-test app file that may read engine fixtures (it seeds demo mode with them). */
const SAMPLE_DATA_FILE = join(SRC_ROOT, "data", "sample.ts");
/** The path alias app code uses to reach the engine's public API (`src/engine/index.ts`). */
const ENGINE_ALIAS = "@engine";

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

const isInside = (root: string, absPath: string): boolean => {
  const rel = relative(root, absPath);
  return !rel.startsWith("..") && !isAbsolute(rel);
};

const isInsideEngine = (absPath: string): boolean => isInside(ENGINE_ROOT, absPath);

const isZod = (spec: string): boolean => spec === "zod" || spec.startsWith("zod/");

const isTestOnlyPackage = (spec: string): boolean =>
  spec === "vitest" || spec === "fast-check" || spec.startsWith("node:");

const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length;

/** Every module specifier in `source` (static, dynamic, side-effect and re-export) with its offset. */
export function importSpecifiers(source: string): { spec: string; index: number }[] {
  const found: { spec: string; index: number }[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[2];
      if (spec !== undefined) found.push({ spec, index: match.index });
    }
  }
  return found;
}

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

  for (const { spec, index } of importSpecifiers(source)) {
    const where = `${filePath}:${lineOf(source, index)}`;
    if (isPathSpecifier(spec)) {
      if (!isInsideEngine(resolve(dirname(filePath), spec))) {
        violations.push(`${where}: import "${spec}" resolves outside src/engine`);
      }
    } else if (!isZod(spec) && !(testLike && isTestOnlyPackage(spec))) {
      violations.push(`${where}: import "${spec}" is not allowed in the engine`);
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

const isAppTestFile = (filePath: string): boolean => /\.test\.tsx?$/.test(filePath);

/** Absolute paths a path-like specifier could mean (a leading `/` may be root-relative, as in Vite). */
const pathCandidates = (filePath: string, spec: string): string[] => {
  if (spec.startsWith(".")) return [resolve(dirname(filePath), spec)];
  if (isAbsolute(spec)) return [spec, resolve(REPO_ROOT, spec.slice(1))];
  return [];
};

/**
 * Checks one app source file (anything under `src/` outside `src/engine/`) against the app boundary
 * rule and returns a violation message per offence (empty array when the file is clean).
 *
 * - App code reaches the engine only through the `@engine` alias (its public API).
 * - Test files (`*.test.ts`, `*.test.tsx`) and `src/data/sample.ts` may also import anything under
 *   `src/engine/__fixtures__/`.
 * - Every other path into `src/engine` (including `@engine/<sub-path>`) is a violation.
 */
export function checkAppSource(filePath: string, source: string): string[] {
  const mayReadFixtures = isAppTestFile(filePath) || resolve(filePath) === SAMPLE_DATA_FILE;
  const violations: string[] = [];

  for (const { spec, index } of importSpecifiers(source)) {
    if (spec === ENGINE_ALIAS) continue;
    const where = `${filePath}:${lineOf(source, index)}`;

    if (spec.startsWith(`${ENGINE_ALIAS}/`)) {
      violations.push(`${where}: import "${spec}" reaches into the engine; import from "${ENGINE_ALIAS}" instead`);
      continue;
    }

    const targets = pathCandidates(filePath, spec).filter(isInsideEngine);
    if (targets.length === 0) continue;
    if (mayReadFixtures && targets.every((t) => isInside(ENGINE_FIXTURES_ROOT, t))) continue;
    violations.push(`${where}: import "${spec}" reaches into src/engine; import from "${ENGINE_ALIAS}" instead`);
  }

  return violations;
}
