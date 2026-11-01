import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAppSource } from "./boundary";

const SRC = resolve(import.meta.dirname, "../src");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

const hook = join(SRC, "features", "deal", "useThing.ts");
const component = join(SRC, "features", "deal", "Thing.tsx");
const componentTest = join(SRC, "features", "deal", "Thing.test.tsx");
const unitTest = join(SRC, "lib", "thing.test.ts");
const sample = join(SRC, "data", "sample.ts");

describe("app boundary: the rule on synthetic sources", () => {
  it("lets app code import the engine through @engine", () => {
    expect(checkAppSource(hook, `import { evaluateDeal } from "@engine";`)).toEqual([]);
    expect(checkAppSource(hook, `import type { DealInputs } from "@engine";`)).toEqual([]);
  });

  it("flags a relative path into the engine, however it is written", () => {
    expect(checkAppSource(hook, `import x from "../../engine/money";`)).toHaveLength(1);
    expect(checkAppSource(hook, `import x from "../../engine";`)).toHaveLength(1);
    expect(checkAppSource(hook, `import x from "../../engine/index";`)).toHaveLength(1);
    expect(checkAppSource(join(SRC, "App.tsx"), `import x from "./engine/money";`)).toHaveLength(1);
    expect(checkAppSource(hook, `import x from "/src/engine/money";`)).toHaveLength(1);
    expect(checkAppSource(hook, `import x from "${join(SRC, "engine", "money")}";`)).toHaveLength(1);
  });

  it("flags @engine/<sub-path>, which the alias does not provide", () => {
    expect(checkAppSource(hook, `import x from "@engine/money";`)).toHaveLength(1);
  });

  it("catches dynamic, side-effect and re-export specifiers", () => {
    expect(checkAppSource(hook, `const m = await import("../../engine/money");`)).toHaveLength(1);
    expect(checkAppSource(hook, `import "../../engine/money";`)).toHaveLength(1);
    expect(checkAppSource(hook, `export * from "../../engine/money";`)).toHaveLength(1);
    expect(checkAppSource(hook, `export { evaluateDeal } from "@engine";`)).toEqual([]);
  });

  it("reports one violation per offending import, with file and line", () => {
    const source = `import a from "@engine";\nimport b from "../../engine/money";\nimport c from "../../engine/dates";`;
    const violations = checkAppSource(hook, source);
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain(`${hook}:2`);
    expect(violations[1]).toContain(`${hook}:3`);
  });

  it("ignores everything that is not an engine path", () => {
    expect(checkAppSource(hook, `import { z } from "zod"; import r from "react"; import "../../styles.css";`)).toEqual([]);
    expect(checkAppSource(hook, `import x from "./local"; import y from "../../data/repository";`)).toEqual([]);
    expect(checkAppSource(hook, `import x from "../../engine-extras/x";`)).toEqual([]);
  });

  it("lets test files import engine fixtures, but nothing else in the engine", () => {
    const fixture = `import golden from "../../engine/__fixtures__/golden";`;
    expect(checkAppSource(componentTest, fixture)).toEqual([]);
    expect(checkAppSource(unitTest, `import golden from "../engine/__fixtures__/golden-deal.inputs.json";`)).toEqual([]);
    expect(checkAppSource(componentTest, `import x from "../../engine/money";`)).toHaveLength(1);
    expect(checkAppSource(componentTest, `import x from "../../engine/__fixtures__/../money";`)).toHaveLength(1);
  });

  it("keeps fixtures out of non-test app code", () => {
    expect(checkAppSource(component, `import golden from "../../engine/__fixtures__/golden";`)).toHaveLength(1);
    expect(checkAppSource(hook, `import g from "../../engine/__fixtures__/golden-deal.inputs.json";`)).toHaveLength(1);
  });

  it("lets only src/data/sample.ts import fixtures among non-test files", () => {
    const json = `import deal from "../engine/__fixtures__/golden-deal.inputs.json"; import comps from "../engine/__fixtures__/golden-comps.json";`;
    expect(checkAppSource(sample, json)).toEqual([]);
    expect(checkAppSource(sample, `import x from "../engine/money";`)).toHaveLength(1);
    expect(checkAppSource(join(SRC, "data", "other.ts"), json)).toHaveLength(2);
    expect(checkAppSource(join(SRC, "lib", "sample.ts"), json)).toHaveLength(2);
  });
});

describe("app boundary: the real source tree", () => {
  it("every app file outside src/engine reaches the engine only as allowed", () => {
    const files = walk(SRC).filter(
      (f) => /\.tsx?$/.test(f) && !f.startsWith(join(SRC, "engine") + "/"),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap((f) => checkAppSource(f, readFileSync(f, "utf8")))).toEqual([]);
  });
});
