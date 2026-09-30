import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This app fetches its own admin data with plain fetch() calls in
      // useEffect (no React Compiler / data library in use), which is
      // exactly the pattern this rule flags. It's intentional here.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Notifications go through src/lib/notify only (catalog wording,
    // central durations/position, de-duplication), so the toast library
    // can be replaced in one place. See docs/notifications-ui.md.
    ignores: ["src/lib/notify/**", "src/components/ui/AppToaster.tsx", "tests/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "sonner", message: "Use notify from \"@/lib/notify\" instead of importing sonner directly." }] },
      ],
    },
  },
  // Generated Prisma client and build output aren't hand-written code.
  globalIgnores(["src/generated/**", ".next-verify/**", "coverage/**"]),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
