import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "frontend/package.json"));
const { build } = require("esbuild");
const temporary = await mkdtemp(join(tmpdir(), "dayfork-contract-"));
try {
  const entry = join(temporary, "contract.mjs");
  await build({
    stdin: { resolveDir: join(root, "frontend"), contents: 'export { buildGenerationContract } from "./src/domain/generation-contract";' },
    bundle: true, platform: "node", format: "esm", outfile: entry,
  });
  const { buildGenerationContract } = await import(entry);
  const output = join(root, "backend/src/main/resources/decision-generation.schema.json");
  await writeFile(output, JSON.stringify(buildGenerationContract(), null, 2) + "\n");
  console.log("Updated backend/src/main/resources/decision-generation.schema.json from the frontend validator.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
