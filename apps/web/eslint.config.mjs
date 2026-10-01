import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Copied out of the pinned pdbe-molstar package by scripts/copy-vendor.mjs.
    // It is a 6 MB minified third-party bundle, not source in this repository.
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
