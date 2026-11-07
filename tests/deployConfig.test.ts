import { existsSync, readFileSync } from "node:fs";
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

  it("runs preflight, then migrate, then deploy", () => {
    expect([deploy.jobs.migrate.needs].flat()).toContain("preflight");
    expect([deploy.jobs.deploy.needs].flat()).toContain("migrate");
  });

  it("only runs on main, whatever started it", () => {
    for (const name of ["preflight", "migrate", "deploy"]) {
      expect(deploy.jobs[name].if).toBe("github.ref == 'refs/heads/main'");
    }
  });

  it("migrate uses the SUPABASE_DB_URL secret as DATABASE_URL and runs db:migrate", () => {
    const text = stepsText(deploy.jobs.migrate);
    expect(text).toContain("secrets.SUPABASE_DB_URL");
    expect(text).toContain("DATABASE_URL");
    expect(text).toContain("::notice::");
    const step = deploy.jobs.migrate.steps.find((x: any) => x.run === "npm run db:migrate");
    expect(step.env.DATABASE_URL).toBe("${{ secrets.SUPABASE_DB_URL }}");
  });

  it("uses the exact secret and variable names", () => {
    const text = JSON.stringify(deploy);
    for (const n of ["secrets.SUPABASE_DB_URL", "secrets.CLOUDFLARE_API_TOKEN", "secrets.CLOUDFLARE_ACCOUNT_ID", "vars.SUPABASE_URL", "vars.SUPABASE_ANON_KEY"]) {
      expect(text).toContain(n);
    }
    expect(text).toContain("VITE_SUPABASE_URL");
    expect(text).toContain("VITE_SUPABASE_ANON_KEY");
  });

  it("preflight guards all four settings", () => {
    const run = deploy.jobs.preflight.steps[0].run as string;
    expect(run).toContain("::error::");
    for (const n of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
      expect(run).toContain('[ -z "$' + n + '" ]');
    }
    const text = JSON.stringify(deploy.jobs.preflight);
    for (const n of ["vars.SUPABASE_URL", "vars.SUPABASE_ANON_KEY", "secrets.CLOUDFLARE_API_TOKEN", "secrets.CLOUDFLARE_ACCOUNT_ID"]) {
      expect(text).toContain(n);
    }
  });

  it("package.json pins yaml exactly and has no wrangler", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.devDependencies.yaml).toMatch(/^[0-9]+[.][0-9]+[.][0-9]+$/);
    expect(JSON.stringify(pkg)).not.toContain("wrangler");
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
    for (const job of [deploy.jobs.migrate, deploy.jobs.deploy]) {
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
      "Content-Security-Policy: default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    ]) {
      expect(lines).toContain(l);
    }
  });

  it("caches hashed assets for a year", () => {
    expect(lines).toContain("/assets/*");
    expect(lines).toContain("Cache-Control: public, max-age=31536000, immutable");
  });
});

describe("the hosted-test build", () => {
  const pkg = JSON.parse(read("package.json"));

  it("runs on Windows too: no VAR=value in front of the command, a mode file instead", () => {
    const script: string = pkg.scripts["build:hosted-test"];
    expect(script).not.toMatch(/^\s*\w+=/);
    expect(script).not.toMatch(/\bVITE_\w+=/);
    expect(script).toContain("--mode hosted-test");
    expect(script).toContain("--outDir dist-hosted");
  });

  it("reads the fake Supabase's address and key from .env.hosted-test, the values tests/e2e/fakeSupabase answers to", () => {
    const lines = read(".env.hosted-test")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
    expect(lines.sort()).toEqual(["VITE_SUPABASE_ANON_KEY=test-anon-key", "VITE_SUPABASE_URL=http://fake-supabase.test"]);
  });

  it("leaves the demo build alone: no .env file a production build would read", () => {
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      expect(existsSync(new URL(`../${name}`, import.meta.url)), name).toBe(false);
    }
  });
});
