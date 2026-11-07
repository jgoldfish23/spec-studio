// Fails (exit 1) if the built site in dist/ holds a secret. Usage: node scripts/check-bundle.mjs [--demo] [dir]
// --demo: the build must hold no Supabase project at all. Output names the file and the rule, never the value.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { scanText } from "./bundleScan.mjs";

const args = process.argv.slice(2);
const demo = args.includes("--demo");
const root = resolve(args.find((a) => !a.startsWith("--")) ?? "dist");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let files;
try {
  files = [...walk(root)];
} catch {
  console.error(`check-bundle: ${root} not found. Run npm run build first.`);
  process.exit(1);
}

let failed = false;
for (const file of files) {
  for (const { rule } of scanText(readFileSync(file).toString("utf8"), { demo })) {
    failed = true;
    console.error(`check-bundle: ${relative(root, file)} matches rule "${rule}"`);
  }
}
if (failed) process.exit(1);
console.log(`check-bundle: checked ${files.length} files${demo ? " (demo rules)" : ""}, no secrets found.`);
