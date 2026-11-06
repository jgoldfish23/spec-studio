import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDatabase, type TestDatabase } from "./helpers";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const SHIM = join(ROOT, "supabase", "tests", "shim.sql");

let db: TestDatabase;
let url: string;
let dirs: string[] = [];

// A database with only the shim applied: the runner applies the migrations itself.
beforeEach(async () => {
  db = await freshDatabase();
  const u = new URL(process.env.DATABASE_URL!);
  const { rows } = await db.client.query("select current_database() as d");
  u.pathname = `/${rows[0].d}`;
  url = u.toString();
  // freshDatabase already applied the migrations; reset to shim-only state.
  await db.client.query("drop schema public cascade; create schema public; drop schema if exists spec_studio_meta cascade");
  await db.client.query("drop schema auth cascade");
  await db.client.query(readFileSync(SHIM, "utf8"));
});

afterEach(async () => {
  await db.drop();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function tempMigrations(): string {
  const d = mkdtempSync(join(tmpdir(), "mig-"));
  dirs.push(d);
  cpSync(MIGRATIONS, d, { recursive: true });
  return d;
}

function run(args: string[] = [], env: Record<string, string> = {}) {
  const r = spawnSync("node", ["scripts/db/migrate.mjs", ...args], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url, ...env },
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const recorded = async () =>
  (await db.client.query("select filename from spec_studio_meta.schema_migrations order by filename")).rows.map(
    (r) => r.filename as string,
  );

describe("db:migrate", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  it("applies every migration and records it, then reports up to date", async () => {
    const first = run();
    expect(first.code, first.out).toBe(0);
    expect(await recorded()).toEqual(files);
    const { rows } = await db.client.query(
      "select checksum, applied_at from spec_studio_meta.schema_migrations where filename = '0001_init.sql'",
    );
    expect(rows[0].checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].applied_at).toBeInstanceOf(Date);

    const second = run();
    expect(second.code).toBe(0);
    expect(second.out).toContain("Up to date");
  });

  it("never prints the connection string", () => {
    const secret = new URL(url);
    secret.password = "s3cretpw";
    const r = run([], { DATABASE_URL: secret.toString() });
    expect(r.out).not.toContain("s3cretpw");
    expect(r.out).not.toContain(secret.host);
  });

  it("refuses an applied file that has changed", () => {
    run();
    const dir = tempMigrations();
    writeFileSync(join(dir, "0001_init.sql"), readFileSync(join(dir, "0001_init.sql"), "utf8") + "\n-- edited\n");
    const r = run([], { MIGRATIONS_DIR: dir });
    expect(r.code).toBe(1);
    expect(r.out).toContain("0001_init.sql has changed since it was applied");
  });

  it("rolls back only the failing file", async () => {
    const dir = tempMigrations();
    writeFileSync(join(dir, "0004_bad.sql"), "create table public.half_done (id int); select 1/0;");
    const r = run([], { MIGRATIONS_DIR: dir });
    expect(r.code).toBe(1);
    expect(r.out).toContain("0004_bad.sql");
    expect(await recorded()).toEqual(files);
    const { rows } = await db.client.query("select to_regclass('public.half_done') as t");
    expect(rows[0].t).toBeNull();
  });

  it("--dry-run lists pending files and applies nothing", async () => {
    const r = run(["--dry-run"]);
    expect(r.code).toBe(0);
    for (const f of files) expect(r.out).toContain(f);
    const { rows } = await db.client.query("select to_regclass('public.deals') as t");
    expect(rows[0].t).toBeNull();
  });

  it("keeps spec_studio_meta away from anon and authenticated", async () => {
    run();
    for (const role of ["anon", "authenticated"]) {
      await db.client.query("begin");
      try {
        await db.client.query(`set local role ${role}`);
        await expect(db.client.query("select * from spec_studio_meta.schema_migrations")).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await db.client.query("rollback");
      }
    }
  });
});

