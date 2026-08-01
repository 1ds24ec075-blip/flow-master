/**
 * Bundles the agent (and the shared serializer it imports from the repo) into
 * a single file, so distribution doesn't depend on the repo layout.
 */

import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // node:sqlite and friends stay external; everything else is inlined.
  external: ["node:*"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/agent.mjs" });
await build({ ...common, entryPoints: ["src/cli.ts"], outfile: "dist/cli.mjs" });

console.log("\nBuilt dist/agent.mjs and dist/cli.mjs");
console.log("Run with: node --disable-warning=ExperimentalWarning dist/agent.mjs");
