import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve("extension");
const manifest = JSON.parse(
  await readFile(resolve(root, "manifest.json"), "utf8"),
);
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, "Intentional");
assert.equal(manifest.incognito, "not_allowed");
const pkg = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.background.type, "module");
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
assert.ok(manifest.optional_host_permissions.length);
assert.ok(
  !manifest.content_security_policy.extension_pages.includes("unsafe-eval"),
);
const files = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...Object.values(manifest.icons),
  ...manifest.web_accessible_resources.flatMap((item) => item.resources),
];
for (const file of files) await access(resolve(root, file));
console.log(
  `Manifest V3 validated. ${files.length} entry points and icons exist.`,
);
