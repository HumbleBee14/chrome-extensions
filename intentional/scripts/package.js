import { mkdir, rm, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

await mkdir("dist", { recursive: true });
const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
const output = resolve(`dist/intentional-${manifest.version}.zip`);
await rm(output, { force: true });
execFileSync("zip", ["-qr", output, ".", "-x", "*.DS_Store", "*/.*", ".*"], {
  cwd: resolve("extension"),
});
execFileSync("zip", ["-qj", output, resolve("LICENSE")]);
console.log(output);
