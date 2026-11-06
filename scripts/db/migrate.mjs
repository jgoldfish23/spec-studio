// Applies supabase/migrations/*.sql in filename order, each in its own transaction, and records a
// sha256 of every applied file. An applied file that has changed stops the run.
// Usage: DATABASE_URL=... node scripts/db/migrate.mjs [--dry-run]   (MIGRATIONS_DIR overrides the folder)
// It never prints DATABASE_URL, or anything derived from it.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dryRun = process.argv.includes("--dry-run");
const dir = process.env.MIGRATIONS_DIR
  ? resolve(process.env.MIGRATIONS_DIR)
  : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set.");

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const sums = new Map(
  files.map((f) => {
    const bytes = readFileSync(join(dir, f));
    return [f, { sql: bytes.toString("utf8"), checksum: createHash("sha256").update(bytes).digest("hex") }];
  }),
);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
} catch {
  // The driver's message can echo the host; say nothing about the connection string.
  fail("Could not connect to the database. Check DATABASE_URL.");
}

try {
  await client.query(`
    create schema if not exists spec_studio_meta;
    create table if not exists spec_studio_meta.schema_migrations (
      filename   text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    );
    revoke all on schema spec_studio_meta from public, anon, authenticated;
    revoke all on all tables in schema spec_studio_meta from public, anon, authenticated;
  `);

  const { rows } = await client.query("select filename, checksum from spec_studio_meta.schema_migrations");
  const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

  for (const [filename, checksum] of applied) {
    const current = sums.get(filename);
    if (current && current.checksum !== checksum) {
      fail(`${filename} has changed since it was applied. Migrations are append-only: add a new file instead.`);
    }
  }

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log("Up to date");
  } else if (dryRun) {
    console.log("Pending (dry run, nothing applied):");
    for (const f of pending) console.log(`  ${f}`);
  } else {
    for (const f of pending) {
      const { sql, checksum } = sums.get(f);
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into spec_studio_meta.schema_migrations (filename, checksum) values ($1, $2)", [f, checksum]);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback").catch(() => undefined);
        fail(`${f} failed and was rolled back: ${e instanceof Error ? e.message : "unknown error"}`);
      }
      console.log(`Applied ${f}`);
    }
  }
} finally {
  await client.end().catch(() => undefined);
}
