import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHIM = join(ROOT, "supabase", "tests", "shim.sql");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

export interface TestDatabase {
  /** Connected as the superuser to the new database. Use `asUser` to act as a signed-in user. */
  client: pg.Client;
  /** Closes the connection and drops the database. */
  drop(): Promise<void>;
}

function connectionString(database?: string): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set; run the tests with `npm run test:db`.");
  if (database === undefined) return base;
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Creates database `t_<random hex>`, applies the test shim and then every migration in filename
 * order. Each test file gets its own, created once and dropped at the end, not one per test.
 */
export async function freshDatabase(): Promise<TestDatabase> {
  const name = `t_${randomBytes(8).toString("hex")}`;

  const admin = new pg.Client({ connectionString: connectionString() });
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: connectionString(name) });
  const dropDatabase = async () => {
    const dropper = new pg.Client({ connectionString: connectionString() });
    await dropper.connect();
    try {
      await dropper.query(`drop database if exists ${name} with (force)`);
    } finally {
      await dropper.end();
    }
  };

  try {
    await client.connect();
    await client.query(readFileSync(SHIM, "utf8"));
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    if (files.length === 0) throw new Error(`No migrations found in ${MIGRATIONS}`);
    for (const file of files) {
      await client.query(readFileSync(join(MIGRATIONS, file), "utf8"));
    }
  } catch (e) {
    await client.end().catch(() => undefined);
    await dropDatabase().catch(() => undefined);
    throw e;
  }

  return {
    client,
    async drop() {
      await client.end().catch(() => undefined);
      await dropDatabase();
    },
  };
}

/**
 * Runs `fn` as a signed-in user (role `authenticated`, JWT subject `userId`), or as `anon` when
 * `userId` is null. The transaction is always rolled back, so nothing `fn` does is kept.
 */
export async function asUser<T>(
  client: pg.Client,
  userId: string | null,
  fn: (c: pg.Client) => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`set local role ${userId === null ? "anon" : "authenticated"}`);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}
