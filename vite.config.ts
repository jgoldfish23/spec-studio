import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * The single source of truth for the `@engine` alias. `vitest.config.ts` merges this config, and
 * `tsconfig.json` repeats the same mapping under `paths` (TypeScript cannot read this file).
 */
export default defineConfig({
  // Relative asset URLs, so the build runs from any static folder (demo mode, file hosting).
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        // Exact match only: `@engine/anything` must fail to resolve rather than reach into the engine.
        find: /^@engine$/,
        replacement: fileURLToPath(new URL("./src/engine/index.ts", import.meta.url)),
      },
    ],
  },
});
