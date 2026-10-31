import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// Playwright's browser specs live in tests/e2e and run through `npm run e2e`; no Vitest project may pick them up.
const exclude = [...configDefaults.exclude, "tests/e2e/**"];

// Projects are split by file extension, not by folder, so a new test lands in the right
// environment without a config change: `.test.ts` is pure logic, `.test.tsx` renders components.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: "node",
            environment: "node",
            include: ["src/**/*.test.ts", "tests/*.test.ts"],
            exclude,
          },
        },
        {
          extends: true,
          test: {
            name: "dom",
            environment: "jsdom",
            include: ["src/**/*.test.tsx"],
            exclude,
            setupFiles: ["src/test-setup.ts"],
          },
        },
        {
          // Needs a Postgres server; run through `npm run test:db`, never part of `npm test`.
          extends: true,
          test: {
            name: "db",
            environment: "node",
            include: ["tests/db/**/*.test.ts"],
            exclude,
          },
        },
      ],
    },
  }),
);
