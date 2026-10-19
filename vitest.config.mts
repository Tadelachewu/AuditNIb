import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit / integration tests (npm test). Node environment by default; UI
// tests opt into jsdom with a `// @vitest-environment jsdom` first line.
export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      // mui-tiptap's package entry sends Node to its CommonJS build, which
      // loads a second copy of ProseMirror next to Tiptap's ES modules
      // ("Adding different instances of a keyed plugin"). Its ES-module build
      // is what the app's webpack build uses, so the tests use it too.
      { find: /^mui-tiptap$/, replacement: fileURLToPath(new URL("./node_modules/mui-tiptap/dist/esm/index.js", import.meta.url)) },
    ],
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
    // Transformed by Vite (not loaded by Node directly), so its ES-module
    // imports resolve to the same Tiptap / ProseMirror copies as the app code.
    server: { deps: { inline: ["mui-tiptap"] } },
  },
});
