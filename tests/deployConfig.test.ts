import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/* eslint-disable @typescript-eslint/no-explicit-any */
const deploy: any = parse(read(".github/workflows/deploy.yml"));
const ci: any = parse(read(".github/workflows/ci.yml"));
const stepsText = (job: any) => JSON.stringify(job.steps);

describe("deploy.yml", () => {
  it("triggers on push to main and manual runs", () => {
    expect(deploy.on.push.branches).toEqual(["main"]);
    expect(deploy.on).toHaveProperty("workflow_dispatch");
  });

  it("has read-only permissions and a non-cancelling concurrency group", () => {
    expect(deploy.permissions).toEqual({ contents: "read" });
    expect(deploy.concurrency.group).toBe("deploy");
    expect(deploy.concurrency["cancel-in-progress"] ?? false).toBe(false);
  });

  it("deploy needs migrate", () => {
    const needs = [deploy.jobs.deploy.needs].flat();
    expect(needs).toContain("migrate");
  });

  it("migrate uses the SUPABASE_DB_URL secret as DATABASE_URL and runs db:migrate", () => {
    const text = stepsText(deploy.jobs.migrate);
    expect(text).toContain("secrets.SUPABASE_DB_URL");
    expect(text).toContain("DATABASE_URL");
    expect(text).toContain("npm run db:migrate");
    expect(text).toContain("::notice::");
  });

  it("uses the exact secret and variable names", () => {
    const text = JSON.stringify(deploy);
    for (const n of ["secrets.SUPABASE_DB_URL", "secrets.CLOUDFLARE_API_TOKEN", "secrets.CLOUDFLARE_ACCOUNT_ID", "vars.SUPABASE_URL", "vars.SUPABASE_ANON_KEY"]) {
      expect(text).toContain(n);
    }
    expect(text).toContain("VITE_SUPABASE_URL");
    expect(text).toContain("VITE_SUPABASE_ANON_KEY");
  });

  it("guards against empty variables and secrets before building", () => {
    const text = stepsText(deploy.jobs.deploy);
    expect(text).toContain("::error::");
    expect(text.indexOf("::error::")).toBeLessThan(text.indexOf("npm run build"));
  });

  it("scans the bundle after the build and before the deploy", () => {
    const text = stepsText(deploy.jobs.deploy);
    const build = text.indexOf("npm run build");
    const scan = text.indexOf("npm run check:bundle");
    const wr = text.indexOf("pages deploy");
    expect(build).toBeGreaterThan(-1);
    expect(scan).toBeGreaterThan(build);
    expect(wr).toBeGreaterThan(scan);
    expect(text).not.toContain("check:bundle -- --demo");
  });

  it("pins wrangler to an exact version", () => {
    const text = stepsText(deploy.jobs.deploy);
    expect(text).toMatch(/wrangler@\d+\.\d+\.\d+ pages deploy dist --project-name=spec-studio --branch=main/);
    expect(text).not.toContain("@latest");
  });

  it("uses the same actions and node as ci.yml", () => {
    for (const job of Object.values<any>(deploy.jobs)) {
      const uses = job.steps.map((s: any) => s.uses).filter(Boolean);
      expect(uses).toContain("actions/checkout@v4");
      expect(uses).toContain("actions/setup-node@v4");
    }
  });

  it("never echoes a secret", () => {
    const raw = read(".github/workflows/deploy.yml");
    expect(raw).not.toMatch(/echo[^\n]*\$\{\{\s*secrets\./);
    expect(raw).not.toMatch(/echo[^\n]*\$(SUPABASE_DB_URL|DATABASE_URL|CLOUDFLARE_API_TOKEN)/);
  });
});

describe("ci.yml", () => {
  it("keeps check, db and e2e", () => {
    expect(Object.keys(ci.jobs)).toEqual(expect.arrayContaining(["check", "db", "e2e"]));
  });

  it("runs the demo bundle scan after the build", () => {
    const runs: string[] = ci.jobs.check.steps.map((s: any) => s.run).filter(Boolean);
    const build = runs.indexOf("npm run build");
    const scan = runs.indexOf("npm run check:bundle -- --demo");
    expect(build).toBeGreaterThan(-1);
    expect(scan).toBeGreaterThan(build);
  });
});

describe("public/_headers", () => {
  const headers = read("public/_headers");
  const lines = headers.split("\n").map((l) => l.trim());

  it("sets the security headers for every path", () => {
    expect(lines).toContain("/*");
    for (const l of [
      "X-Frame-Options: DENY",
      "Referrer-Policy: strict-origin-when-cross-origin",
      "X-Content-Type-Options: nosniff",
      "Content-Security-Policy: default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    ]) {
      expect(lines).toContain(l);
    }
  });

  it("caches hashed assets for a year", () => {
    expect(lines).toContain("/assets/*");
    expect(lines).toContain("Cache-Control: public, max-age=31536000, immutable");
  });
});
