import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkEngineSource } from "./boundary";

const ENGINE = join(process.cwd(), "src/engine");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

describe("engine boundary", () => {
  it("flags imports that leave the engine", () => {
    expect(checkEngineSource(join(ENGINE, "a.ts"), `import x from "../data/db";`)).toHaveLength(1);
    expect(checkEngineSource(join(ENGINE, "a.ts"), `import React from "react";`)).toHaveLength(1);
    expect(checkEngineSource(join(ENGINE, "a.ts"), `import { z } from "zod"; import { a } from "./b";`)).toEqual([]);
  });
  it("flags clock and randomness in non-test files", () => {
    expect(checkEngineSource(join(ENGINE, "a.ts"), `const t = Date.now();`)).toHaveLength(1);
    expect(checkEngineSource(join(ENGINE, "a.ts"), `const t = new Date();`)).toHaveLength(1);
    expect(checkEngineSource(join(ENGINE, "a.ts"), `const r = Math.random();`)).toHaveLength(1);
    expect(checkEngineSource(join(ENGINE, "a.test.ts"), `import { it } from "vitest"; Date.now();`)).toEqual([]);
  });
  it("treats __fixtures__ like test files, but never lets them leave the engine", () => {
    const fixture = join(ENGINE, "__fixtures__", "golden.ts");
    expect(checkEngineSource(fixture, `import fc from "fast-check"; import { readFileSync } from "node:fs"; Date.now();`)).toEqual([]);
    expect(checkEngineSource(fixture, `import x from "../../data/db";`)).toHaveLength(1);
  });
  it("only lets test-like files import test tooling", () => {
    const src = join(ENGINE, "a.ts");
    expect(checkEngineSource(src, `import { it } from "vitest";`)).toHaveLength(1);
    expect(checkEngineSource(src, `import fc from "fast-check";`)).toHaveLength(1);
    expect(checkEngineSource(src, `import { readFileSync } from "node:fs";`)).toHaveLength(1);
  });
  it("catches dynamic, side-effect and re-export specifiers and sibling-directory escapes", () => {
    const src = join(ENGINE, "sub", "a.ts");
    expect(checkEngineSource(src, `const m = await import("react");`)).toHaveLength(1);
    expect(checkEngineSource(src, `import "../../data/side-effect";`)).toHaveLength(1);
    expect(checkEngineSource(src, `export * from "../../engine-other/x";`)).toHaveLength(1);
    expect(checkEngineSource(src, `export { y } from "../b"; import("./c");`)).toEqual([]);
  });
  it("allows new Date(arg) but not the no-argument clock read", () => {
    const src = join(ENGINE, "a.ts");
    expect(checkEngineSource(src, `const d = new Date("2026-10-30");`)).toEqual([]);
    expect(checkEngineSource(src, `const d = new Date( );`)).toHaveLength(1);
  });
  it("every engine file passes", () => {
    const files = walk(ENGINE).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap((f) => checkEngineSource(f, readFileSync(f, "utf8")))).toEqual([]);
  });
});
