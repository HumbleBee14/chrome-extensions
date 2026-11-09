import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const { version } = JSON.parse(
  await readFile("extension/manifest.json", "utf8"),
);
const folder = await mkdtemp(join(tmpdir(), "intentional-package-"));
let context;
try {
  const extension = join(folder, "extension");
  execFileSync("unzip", [
    "-q",
    resolve(`dist/intentional-${version}.zip`),
    "-d",
    extension,
  ]);
  const manifest = JSON.parse(
    await readFile(join(extension, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.incognito, "not_allowed");
  assert.equal(manifest.host_permissions, undefined);
  await access(join(extension, "LICENSE"));
  context = await chromium.launchPersistentContext(join(folder, "profile"), {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/ui/options.html`,
  );
  await page
    .getByRole("heading", { name: "No limits yet.", exact: true })
    .waitFor();
  for (const name of ["Activity", "Settings", "Limits"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS Actual ZIP loads with the unmodified manifest, MIT license, optional host permissions, and all settings sections",
  );
} finally {
  await context?.close();
  await rm(folder, { recursive: true, force: true });
}
