import { setChoices, choices } from "./preset-helpers.js";
import { chromium } from "playwright";
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http from "node:http";
import assert from "node:assert/strict";

const profile = await mkdtemp(join(tmpdir(), "intentional-ui-"));
const extension = join(profile, "extension");
await cp(resolve("extension"), extension, { recursive: true });
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.permissions.push("tabs");
manifest.optional_permissions = [];
manifest.host_permissions = ["http://*.localhost/*", "https://*.localhost/*"];
await writeFile(manifestPath, JSON.stringify(manifest));
const server = http.createServer((req, res) =>
  res.end("<!doctype html><title>Website fixture</title><h1>Website</h1>"),
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://localhost:${server.address().port}`;
let context;
const tree = async (cdp) =>
  (await cdp.send("Accessibility.getFullAXTree")).nodes.filter(
    (node) => !node.ignored,
  );
const names = async (cdp) =>
  (await tree(cdp)).map((node) => node.name?.value || "").join("\n");
async function waitFor(condition, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
async function control(cdp, role, label, fn, args = []) {
  const item = (await tree(cdp)).find(
    (node) => node.role?.value === role && node.name?.value === label,
  );
  assert.ok(item, `Missing ${role}: ${label}`);
  const { object } = await cdp.send("DOM.resolveNode", {
    backendNodeId: item.backendDOMNodeId,
  });
  const result = await cdp.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: fn,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
  });
  return result.result.value;
}
const click = (cdp, label) =>
  control(cdp, "button", label, "function() { this.click(); }");
try {
  context = await chromium.launchPersistentContext(profile, {
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
  const app = `chrome-extension://${new URL(worker.url()).host}/ui/`;
  const state = () =>
    worker.evaluate(
      async () => (await chrome.storage.local.get("state")).state,
    );
  const settings = await context.newPage();
  await settings.goto(`${app}options.html`);
  await settings.getByRole("tab", { name: "Settings", exact: true }).click();
  assert.ok(
    (await choices(settings, "global-presets")).includes("Quick Check"),
  );
  await setChoices(settings, "global-presets", ["x".repeat(31)]);
  assert.equal((await choices(settings, "global-presets"))[0], "x".repeat(16));
  await setChoices(settings, "global-presets", ["Research", "Casual browsing"]);
  await settings.locator("#save-presets").click();
  await waitFor(
    async () => (await state()).settings.reasonPresets?.length === 2,
    "global reasons saved",
  );
  await settings.locator("#strict-toggle").click();
  await settings
    .getByRole("button", { name: "Disable guard", exact: true })
    .waitFor();
  await settings.locator("#strict-toggle").click();
  await settings
    .getByRole("button", { name: "Enable guard", exact: true })
    .waitFor();
  await settings.reload();
  assert.equal(await settings.locator("#page-title").textContent(), "Settings");
  assert.deepEqual(await choices(settings, "global-presets"), [
    "Research",
    "Casual browsing",
  ]);
  await settings.getByRole("tab", { name: "Limits", exact: true }).click();
  await settings.locator("#add-rule").click();
  await settings.locator("#target").fill("localhost/read");
  await settings.locator("#label").fill("Reading");
  await settings.locator("#dailyMinutes").fill("20");
  await settings.locator("#message").fill("Make this time count.");
  await settings.locator("#message-color-picker > summary").click();
  await settings.locator('.color-choice[title="Blue"]').click();
  await settings.locator("#save-rule").click();
  await settings.locator("#rule-dialog").waitFor({ state: "hidden" });
  for (const width of [1280, 390, 320]) {
    await settings.setViewportSize({ width, height: 720 });
    for (const panel of ["Limits", "Activity", "Settings"]) {
      await settings.getByRole("tab", { name: panel, exact: true }).click();
      assert.equal(
        await settings.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${panel} fits ${width}px`,
      );
      assert.equal(
        await settings
          .locator("body")
          .evaluate((el) => getComputedStyle(el).fontSize),
        "16px",
      );
      await settings.screenshot({
        path: `artifacts/${panel.toLowerCase()}-${width}.png`,
      });
    }
  }
  await settings.setViewportSize({ width: 1280, height: 720 });
  await settings.getByRole("tab", { name: "Limits", exact: true }).click();
  const ruleId = (await state()).rules[0].id;
  const page = await context.newPage();
  await page.goto(`${base}/read/article`);
  await page.bringToFront();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Accessibility.enable");
  await waitFor(
    async () => (await names(cdp)).includes("What brings you here?"),
    "compact prompt",
  );
  assert.ok((await names(cdp)).includes("Max 20 min"));
  assert.equal(
    (await tree(cdp)).some((node) => node.role?.value === "combobox"),
    false,
  );
  assert.equal((await names(cdp)).includes("Use reason:"), false);
  const color = await control(
    cdp,
    "StaticText",
    "Make this time count.",
    "function() { return getComputedStyle(this.nodeType === 1 ? this : this.parentElement).color; }",
  );
  assert.equal(color, "rgb(9, 105, 255)");
  assert.equal(
    await control(
      cdp,
      "StaticText",
      "Make this time count.",
      "function() { return getComputedStyle(this.nodeType === 1 ? this : this.parentElement).fontWeight; }",
    ),
    "700",
  );
  await control(
    cdp,
    "textbox",
    "Reason",
    "function() { this.value = 're'; this.dispatchEvent(new Event('input')); this.focus(); }",
  );
  assert.ok((await names(cdp)).includes("Use reason: Research"));
  await page.screenshot({ path: "artifacts/reason-typing-hint.png" });
  await page.keyboard.press("Escape");
  assert.equal((await names(cdp)).includes("Use reason: Research"), false);
  await control(
    cdp,
    "textbox",
    "Reason",
    "function() { this.value = 'RE'; this.dispatchEvent(new Event('input')); }",
  );
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  assert.equal(
    await control(
      cdp,
      "textbox",
      "Reason",
      "function() { return this.value; }",
    ),
    "Research",
  );
  assert.equal((await names(cdp)).includes("Use reason: Research"), false);
  assert.equal((await state()).logs.length, 0);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Research a specific topic");
  await page.keyboard.press("Tab");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("5");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitFor(
    async () => (await state()).logs[0]?.reason === "Research a specific topic",
    "editable preset saved",
  );
  await mkdir("artifacts", { recursive: true });

  const popup = await context.newPage();
  await page.bringToFront();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(`${app}popup.html`);
  await popup.getByRole("heading", { name: "Reading", exact: true }).waitFor();
  await popup
    .getByRole("button", { name: "Edit limit", exact: true })
    .waitFor();
  assert.equal(
    await popup.getByRole("button", { name: "View all limits" }).count(),
    0,
  );
  const firstCountdown = await popup.locator(".popup-countdown").textContent();
  const firstUsage = await popup
    .locator("progress")
    .evaluate((node) => node.value);
  await waitFor(
    async () =>
      (await popup.locator(".popup-countdown").textContent()) !==
      firstCountdown,
    "popup countdown ticks without reopening",
    3500,
  );
  await waitFor(
    async () =>
      (await popup.locator("progress").evaluate((node) => node.value)) >
      firstUsage,
    "popup usage progresses while open",
    3500,
  );
  await worker.evaluate(async (id) => {
    const { state } = await chrome.storage.local.get("state");
    state.sessions[id].deadline = Date.now() + 1500;
    await chrome.storage.local.set({ state });
  }, ruleId);
  await popup
    .getByText("Time to check in", { exact: true })
    .waitFor({ timeout: 10000 });
  console.log(
    "PASS Open popup ticks usage/countdown and shows session expiry without reopening",
  );
  const originalRule = (await state()).rules[0];
  const changedMinutes = originalRule.dailyMinutes + 1;
  await settings.evaluate(
    async (rule) => {
      const response = await chrome.runtime.sendMessage({
        type: "SAVE_RULE",
        rule,
      });
      if (!response.ok) throw new Error(response.error);
    },
    { ...originalRule, dailyMinutes: changedMinutes },
  );
  await waitFor(
    async () =>
      (await popup.locator("body").textContent()).includes(
        `${changedMinutes} min limit`,
      ),
    "popup updates immediately after settings save",
    2000,
  );
  await settings.evaluate(
    (rule) => chrome.runtime.sendMessage({ type: "SAVE_RULE", rule }),
    originalRule,
  );
  await popup.screenshot({ path: "artifacts/popup-current-site.png" });
  const opened = context.waitForEvent("page");
  await popup.getByRole("button", { name: "Edit limit", exact: true }).click();
  const editor = await opened;
  await editor.locator("#rule-dialog").waitFor({ state: "visible" });
  assert.equal(await editor.locator("#label").inputValue(), "Reading");
  await editor.close();
  await popup.close();

  await settings.bringToFront();
  await settings
    .getByRole("button", { name: "Edit Reading", exact: true })
    .click();
  await settings.locator("#message-color-picker > summary").click();
  await settings.locator('.color-choice[title="Red"]').click();
  await settings.locator("#save-rule").click();
  await settings.locator("#rule-dialog").waitFor({ state: "hidden" });
  await page.bringToFront();
  await waitFor(
    async () => (await names(cdp)).includes("What brings you here?"),
    "custom prompt",
  );
  assert.equal(
    await control(
      cdp,
      "StaticText",
      "Make this time count.",
      "function() { return getComputedStyle(this.nodeType === 1 ? this : this.parentElement).color; }",
    ),
    "rgb(229, 37, 42)",
  );
  await page.waitForTimeout(250);
  await page.screenshot({ path: "artifacts/intention-prompt-clean.png" });
  await page.setViewportSize({ width: 390, height: 667 });
  await page.screenshot({
    path: "artifacts/intention-prompt-clean-mobile.png",
  });
  await control(
    cdp,
    "textbox",
    "Reason",
    "function() { this.value = 'A completely personal reason'; this.dispatchEvent(new Event('input')); }",
  );
  assert.equal((await names(cdp)).includes("Use reason:"), false);
  await control(
    cdp,
    "textbox",
    "Reason",
    "function() { this.value = 'Casual'; this.dispatchEvent(new Event('input')); }",
  );
  await click(cdp, "Use reason: Casual browsing");
  await click(cdp, "Continue");
  await waitFor(
    async () => !(await names(cdp)).includes("What brings you here?"),
    "custom preset approval",
  );
  const changeDeadline = async (milliseconds) => {
    await settings.evaluate(() =>
      chrome.runtime.sendMessage({ type: "DASHBOARD" }),
    );
    await worker.evaluate(
      async ({ id, milliseconds }) => {
        const { state } = await chrome.storage.local.get("state");
        state.sessions[id].deadline = Date.now() + milliseconds;
        await chrome.storage.local.set({ state });
      },
      { id: ruleId, milliseconds },
    );
    await settings.evaluate(() =>
      chrome.runtime.sendMessage({ type: "DASHBOARD" }),
    );
  };
  await changeDeadline(29000);
  await waitFor(
    async () => (await names(cdp)).includes("Dismiss warning"),
    "30-second reminder",
  );
  await click(cdp, "Dismiss warning");
  await page.reload();
  await waitFor(
    async () => (await names(cdp)).includes("left"),
    "reload countdown",
  );
  assert.equal((await names(cdp)).includes("Dismiss warning"), false);
  await page.goto(`${base}/read/child`);
  await waitFor(
    async () => (await names(cdp)).includes("left"),
    "child countdown",
  );
  assert.equal((await names(cdp)).includes("Dismiss warning"), false);
  await changeDeadline(18000);
  await waitFor(
    async () => (await names(cdp)).includes("Dismiss warning"),
    "renewed warning window",
  );
  await click(cdp, "Dismiss warning");
  const renewedDeadline = (await state()).sessions[ruleId].deadline;
  await waitFor(
    () => Date.now() >= renewedDeadline - 9000,
    "no second reminder in final seconds",
  );
  assert.equal((await names(cdp)).includes("Dismiss warning"), false);
  // Saving targets and durations must update an already-open document without reload.
  await settings.bringToFront();
  await settings
    .getByRole("button", { name: "Edit Reading", exact: true })
    .click();
  await settings.locator("#dailyMinutes").fill("1.5");
  await settings.locator("#save-rule").click();
  assert.equal(
    await settings.locator("#rule-dialog").evaluate((node) => node.open),
    true,
  );
  await settings.locator("#dailyMinutes").fill("3");
  await settings.locator("#save-rule").click();
  await settings.locator("#rule-dialog").waitFor({ state: "hidden" });
  await waitFor(
    async () =>
      (await names(cdp)).includes("Max 2 min") ||
      (await names(cdp)).includes("Max 3 min"),
    "duration updated immediately",
    2000,
  );
  await settings
    .getByRole("button", { name: "Edit Reading", exact: true })
    .click();
  await settings.locator("#target").fill("localhost/other");
  await settings.locator("#save-rule").click();
  await settings.locator("#rule-dialog").waitFor({ state: "hidden" });
  await waitFor(
    async () => !(await names(cdp)).includes("What brings you here?"),
    "old target cleared immediately",
    2000,
  );
  await settings
    .getByRole("button", { name: "Edit Reading", exact: true })
    .click();
  await settings.locator("#target").fill("localhost/read");
  await settings.locator("#save-rule").click();
  await settings.locator("#rule-dialog").waitFor({ state: "hidden" });
  await waitFor(
    async () => (await names(cdp)).includes("What brings you here?"),
    "new target applied immediately",
    2000,
  );
  console.log(
    "PASS Whole-minute validation and live target/duration edits without page reload",
  );
  await page.bringToFront();
  await control(
    cdp,
    "textbox",
    "Reason",
    "function() { this.value='Verify shared usage'; this.dispatchEvent(new Event('input')); }",
  );
  await click(cdp, "Continue");
  await waitFor(
    async () => !(await names(cdp)).includes("What brings you here?"),
    "start tracked close-tab visit",
  );
  const beforeCloseVisit = Object.values((await state()).days).reduce(
    (sum, day) => sum + (day[ruleId] || 0),
    0,
  );
  await page.waitForTimeout(2200);
  await page.close();
  await settings.bringToFront();
  await waitFor(
    async () => {
      const saved = Object.values((await state()).days).reduce(
        (sum, day) => sum + (day[ruleId] || 0),
        0,
      );
      const displayed = await settings
        .locator("#rules progress")
        .evaluate((node) => node.value);
      return saved >= beforeCloseVisit + 1800 && displayed === saved;
    },
    "returning dashboard immediately matches final stored usage after tab closes",
    3000,
  );
  assert.equal(await settings.locator(".rule-divider").textContent(), "|");
  console.log(
    "PASS Closing a tab settles final usage; the existing dashboard immediately reads that same counter",
  );
  console.log(
    "PASS Common reason hints match typed prefixes, support Escape and free text, and require explicit continuation",
  );
  console.log(
    "PASS Message colors appear on the live prompt and update when a rule changes",
  );
  console.log(
    "PASS Popup renders the current site and opens the existing limit directly for editing",
  );
  console.log(
    "PASS The single 30-second reminder stays dismissed across refreshes, child pages, and final seconds",
  );
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
