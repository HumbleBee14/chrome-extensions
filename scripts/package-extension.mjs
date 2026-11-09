import { readFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

export const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export const extensions = JSON.parse(
  await readFile(new URL("extensions.json", import.meta.url), "utf8"),
);

export async function packageExtension(
  slug,
  outputDir = join(repoRoot, "dist"),
) {
  const config = extensions[slug];
  if (!config) throw new Error("Choose vblur or intentional.");
  const root = join(repoRoot, config.root);
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  );
  await mkdir(outputDir, { recursive: true });
  const output = resolve(outputDir, `${slug}-${manifest.version}.zip`);
  await rm(output, { force: true });
  execFileSync(
    "zip",
    ["-qr", output, ...config.files, "-x", "*.DS_Store", "*/.*", ".*"],
    { cwd: root },
  );
  execFileSync("zip", ["-qj", output, join(repoRoot, config.license)]);
  return output;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(await packageExtension(process.argv[2]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
