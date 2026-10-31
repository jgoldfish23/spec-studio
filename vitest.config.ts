import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

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
          },
        },
        {
          extends: true,
          test: {
            name: "dom",
            environment: "jsdom",
            include: ["src/**/*.test.tsx"],
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
          },
        },
      ],
    },
  }),
);
