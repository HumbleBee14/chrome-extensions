import { createState } from "../extension/core/engine.js";
import { normalizeRule } from "../extension/core/rules.js";
import { chromium } from "playwright";
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http from "node:http";
import assert from "node:assert/strict";

const profile = await mkdtemp(join(tmpdir(), "intentional-reconnect-"));
const extension = join(profile, "extension");
await cp(resolve("extension"), extension, { recursive: true });
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions = ["http://*.localhost/*"];
await writeFile(manifestPath, JSON.stringify(manifest));
const server = http.createServer((req, res) =>
  res.end("<!doctype html><title>Reconnect fixture</title><h1>Website</h1>"),
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://localhost:${server.address().port}`;
let context;
const tree = async (cdp) =>
  (await cdp.send("Accessibility.getFullAXTree")).nodes.filter(
    (node) => !node.ignored,
  );
async function waitFor(condition) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    "Reconnect screen did not appear after a real extension reload",
  );
}
async function click(cdp, label) {
  const button = (await tree(cdp)).find(
    (node) => node.role?.value === "button" && node.name?.value === label,
  );
  assert.ok(button, `Missing button: ${label}`);
  const { object } = await cdp.send("DOM.resolveNode", {
    backendNodeId: button.backendDOMNodeId,
  });
  await cdp.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: "function() { this.click(); }",
  });
}
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  let worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const bootstrap = await context.newPage();
  await bootstrap.goto(
    `chrome-extension://${new URL(worker.url()).host}/ui/options.html`,
  );
  await bootstrap
    .locator("#global-presets input[data-reason]")
    .first()
    .waitFor({ state: "attached" });
  const previous = createState();
  previous.settings.reasonPresets = ["My own choice"];
  previous.rules = [
    normalizeRule({
      id: "existing",
      target: "example.com",
      mode: "domain",
      dailyMinutes: 10,
      enabled: false,
      useSavedReasons: true,
      presetMode: "custom",
    }),
  ];
  previous.rules[0].reasonPresets = ["A previously saved long reason"];
  await worker.evaluate(
    (state) => chrome.storage.local.set({ state }),
    previous,
  );
  await bootstrap.evaluate(() =>
    chrome.runtime.sendMessage({ type: "DASHBOARD" }),
  );
  const beforeUpdate = await worker.evaluate(
    async () => (await chrome.storage.local.get("state")).state,
  );
  assert.deepEqual(beforeUpdate.settings.reasonPresets, ["My own choice"]);
  await bootstrap.close();
  await context.close();
  manifest.version = "1.0.1";
  await writeFile(manifestPath, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const inspector = await context.newPage();
  await inspector.goto(
    `chrome-extension://${new URL(worker.url()).host}/ui/options.html`,
  );
  await inspector
    .locator("#global-presets input[data-reason]")
    .first()
    .waitFor({ state: "attached" });
  const restored = await inspector.evaluate(
    async () => (await chrome.storage.local.get("state")).state,
  );
  assert.deepEqual(restored.settings.reasonPresets, ["My own choice"]);
  assert.deepEqual(restored.rules[0].reasonPresets, [
    "A previously saved long reason",
  ]);
  await inspector.close();
  const leave = await context.newPage();
  const reload = await context.newPage();
  await leave.goto(`${base}/leave`);
  await reload.goto(`${base}/reload`);
  await worker.evaluate(async (base) => {
    const tabs = (await chrome.tabs.query({})).filter((tab) =>
      tab.url?.startsWith(base),
    );
    await Promise.all(
      tabs.map((tab) =>
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content/styles.js", "content/index.js"],
        }),
      ),
    );
  }, base);
  await leave.locator("intentional-guard").waitFor({ state: "attached" });
  await reload.locator("intentional-guard").waitFor({ state: "attached" });
  const leaveCdp = await context.newCDPSession(leave);
  const reloadCdp = await context.newCDPSession(reload);
  await leaveCdp.send("Accessibility.enable");
  await reloadCdp.send("Accessibility.enable");
  await worker
    .evaluate(() => chrome.runtime.reload())
    .catch((error) => {
      if (!/context|closed|destroyed/i.test(error.message)) throw error;
    });
  await leave.bringToFront();
  await waitFor(async () =>
    (await tree(leaveCdp)).some(
      (node) => node.name?.value === "Please reload this page.",
    ),
  );
  const names = (await tree(leaveCdp))
    .map((node) => node.name?.value || "")
    .join("\n");
  assert.equal(names.includes("Resets at midnight."), false);
  assert.equal(
    names.includes("You’ve used the time you set aside for this."),
    false,
  );
  await mkdir("artifacts", { recursive: true });
  await leave.screenshot({ path: "artifacts/reconnect.png" });
  await click(leaveCdp, "Leave this page");
  await leave.waitForURL("about:blank");
  assert.equal(await leave.locator("intentional-guard").count(), 0);
  await reload.bringToFront();
  await waitFor(async () =>
    (await tree(reloadCdp)).some(
      (node) => node.name?.value === "Please reload this page.",
    ),
  );
  const loaded = reload.waitForEvent("load");
  await click(reloadCdp, "Reload page");
  await loaded;
  assert.equal(reload.url(), `${base}/reload`);
  assert.equal(await reload.locator("intentional-guard").count(), 0);
  console.log(
    "PASS A version update preserves existing common and legacy custom reasons",
  );
  console.log(
    "PASS A real extension reload shows a dedicated reconnect screen without daily-limit copy",
  );
  console.log(
    "PASS Leave opens about:blank even after the extension context is invalidated",
  );
  console.log(
    "PASS Reload refreshes the original website from the disconnected screen",
  );
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
