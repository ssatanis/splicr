/**
 * Copy the structure viewer's browser bundle into public/ before a build.
 *
 * WHY THE FILE IS COPIED RATHER THAN COMMITTED
 *
 * pdbe-molstar ships a 6 MB self-registering custom element that has to be loaded
 * as a plain <script>, not imported as a module. It used to be committed under
 * public/vendor/, byte-identical to the pinned npm package: two copies of the same
 * 6 MB, one of which nothing could update. Copying it from node_modules at build
 * time keeps the pinned version in package.json the only source, and keeps the
 * script on our own origin so no page loads a third-party script.
 *
 * The CSS is not copied. It is imported from the package by the one client
 * component that needs it, so Next.js puts it in that component's chunk rather
 * than on every page.
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("pdbe-molstar/package.json");
const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
const source = join(dirname(pkgPath), "build", "pdbe-molstar-component.js");

// The version is in the served path so a browser cannot hold a stale bundle after
// the dependency moves. It must match VIEWER_VERSION in
// src/components/dashboard/evidence/structure-viewer.tsx; a web test checks that
// the two agree and that both match the installed package.
const target = join(
  import.meta.dirname, "..", "public", "vendor", "pdbe-molstar",
  `pdbe-molstar-component-${version}.js`,
);
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`vendor: pdbe-molstar ${version} -> public/vendor/pdbe-molstar/`);
