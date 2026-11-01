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
  build: {
    // The five step screens are lazy chunks of about 20 kB each. What is left in the entry chunk is what every screen
    // needs, mostly libraries (React DOM, the router, zod, TanStack Query) plus the engine: 550 kB, 171 kB gzipped.
    // That is above Vite's 500 kB default, so the notice is set to the next 100 kB up; growth past it is worth a look.
    chunkSizeWarningLimit: 600,
  },
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
