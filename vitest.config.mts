import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit / integration tests (npm test). Node environment by default; UI
// tests opt into jsdom with a `// @vitest-environment jsdom` first line.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
  },
});
