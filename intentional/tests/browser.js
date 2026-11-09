import { chromium } from "playwright";
import { mkdtemp, mkdir, rm, writeFile, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import http from "node:http";
import assert from "node:assert/strict";

const profile = await mkdtemp(join(tmpdir(), "intentional-browser-"));
const extension = join(profile, "fixture-extension");
await cp(resolve("extension"), extension, { recursive: true });
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions = ["http://*.localhost/*", "https://*.localhost/*"];
manifest.permissions.push("tabs");
manifest.optional_permissions = [];
await writeFile(manifestPath, JSON.stringify(manifest));
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html lang="en"><head><title>Focus fixture</title></head><body><h1>Website fixture</h1><button id="shorts" onclick="history.pushState({},\'\',\'/shorts/video\')">Open Shorts</button><button id="home" onclick="history.pushState({},\'\',\'/home\')">Go home</button><p>This page stands in for a website with client-side navigation.</p></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const base = `http://localhost:${port}`;
const failures = [];
const checks = [];
let context;

async function waitFor(condition, label, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}

const launch = () =>
  chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });

try {
  context = await launch();
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const appUrl = `chrome-extension://${id}/ui/`;
  let settings = await context.newPage();
  settings.on("pageerror", (error) => failures.push(error.message));
  await settings.goto(`${appUrl}options.html`);
  await settings.getByRole("heading", { name: "No limits yet." }).waitFor();
  checks.push("Unpacked Manifest V3 extension loads with default empty state");
  await settings
    .getByRole("button", { name: "YouTube Shorts", exact: true })
    .click();
  await settings.locator("#target").fill("localhost/shorts");
  await settings.locator("#label").fill("Shorts boundary");
  await settings.locator("#dailyMinutes").fill("10");
  await settings.locator("#intentionalVisits").check();
  assert.equal(await settings.locator("#preventOverrides").count(), 1);
  assert.equal(await settings.locator("#preventOverrides").isChecked(), false);
  assert.equal(await settings.locator("#overrideMinutes").count(), 0);
  await settings.locator("#preventOverrides").check();
  await settings
    .getByRole("button", { name: "Save limit", exact: true })
    .click();
  await settings
    .getByRole("heading", { name: "Shorts boundary", exact: true })
    .waitFor({ timeout: 10000 });
  checks.push(
    "Real settings form saves a rule using pregranted localhost access in the test manifest",
  );
  await mkdir("artifacts", { recursive: true });
  await settings.screenshot({ path: "artifacts/settings.png", fullPage: true });
  let page = await context.newPage();
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(`${base}/home`);
  await page.bringToFront();
  let cdp = await context.newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const ax = async () =>
    (await cdp.send("Accessibility.getFullAXTree")).nodes
      .filter((node) => !node.ignored)
      .map((node) => node.name?.value || "")
      .join("\n");
  const clickGateButton = async (name) => {
    const item = (await cdp.send("Accessibility.getFullAXTree")).nodes.find(
      (node) =>
        !node.ignored &&
        node.role?.value === "button" &&
        node.name?.value === name,
    );
    assert.ok(item, `Missing button: ${name}`);
    const { object } = await cdp.send("DOM.resolveNode", {
      backendNodeId: item.backendDOMNodeId,
    });
    await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function() { this.click(); }",
    });
  };
  const readReason = async () => {
    const item = (await cdp.send("Accessibility.getFullAXTree")).nodes.find(
      (node) =>
        !node.ignored &&
        node.role?.value === "textbox" &&
        node.name?.value === "Reason",
    );
    const { object } = await cdp.send("DOM.resolveNode", {
      backendNodeId: item.backendDOMNodeId,
    });
    return (
      await cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: "function() { return this.value; }",
        returnByValue: true,
      })
    ).result.value;
  };
  const openExtraTime = async (attempt) => {
    await waitFor(
      async () => (await ax()).includes("Daily limit reached."),
      "daily boundary before extra time",
      12000,
    );
    assert.equal((await ax()).includes("Time in minutes"), false);
    assert.equal((await ax()).includes(`Override #${attempt}`), false);
    assert.ok((await ax()).includes("Resets at midnight."));
    await clickGateButton("Choose extra time");
    await waitFor(
      async () => (await ax()).includes(`Override #${attempt}`),
      "explicit extra-time form",
    );
  };
  await page.locator("#shorts").click();
  await waitFor(
    async () => (await ax()).includes("What brings you here?"),
    "SPA path prompt",
  );
  checks.push("Entering a monitored SPA path opens a modal intention gate");
  assert.equal(
    await page.evaluate(
      () => document.querySelector("intentional-guard").shadowRoot,
    ),
    null,
  );
  await page.keyboard.press("Escape");
  assert.equal((await ax()).includes("What brings you here?"), true);
  await page.waitForTimeout(250);
  await page.screenshot({ path: "artifacts/intention.png" });
  await page.keyboard.type("Learn something useful");
  await page.keyboard.press("Tab");
  const durationNode = (
    await cdp.send("Accessibility.getFullAXTree")
  ).nodes.find((node) => !node.ignored && node.role?.value === "spinbutton");
  assert.equal(Number(durationNode.value?.value), 10);
  const { object: durationInput } = await cdp.send("DOM.resolveNode", {
    backendNodeId: durationNode.backendDOMNodeId,
  });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("11");
  const validation = await cdp.send("Runtime.callFunctionOn", {
    objectId: durationInput.objectId,
    functionDeclaration: "function() { return this.validationMessage; }",
    returnByValue: true,
  });
  assert.match(validation.result.value, /whole minutes/);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  assert.ok((await ax()).includes("What brings you here?"));
  await cdp.send("Runtime.callFunctionOn", {
    objectId: durationInput.objectId,
    functionDeclaration: "function() { this.focus(); }",
  });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("5");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitFor(
    async () => !(await ax()).includes("What brings you here?"),
    "intention approval",
  );
  assert.equal((await ax()).includes("Wrap up your current work."), false);
  let currentWorker = worker;
  const readState = () =>
    currentWorker.evaluate(
      async () => (await chrome.storage.local.get("state")).state,
    );
  const state = await readState();
  assert.equal(state.logs[0].reason, "Learn something useful");
  assert.equal(state.logs[0].minutes, 5);
  const ruleId = state.rules[0].id;
  const originalDeadline = state.sessions[ruleId].deadline;
  checks.push(
    "Duration defaults to the smaller daily allowance, rejects excess time, and logs the approved reason and duration",
  );
  await page.reload();
  await waitFor(async () => (await ax()).includes("left"), "reload countdown");
  assert.equal((await ax()).includes("What brings you here?"), false);
  await page.goto(`${base}/shorts/child`);
  await waitFor(async () => (await ax()).includes("left"), "child countdown");
  assert.equal((await ax()).includes("What brings you here?"), false);
  const anotherTab = await context.newPage();
  await anotherTab.goto(`${base}/shorts/another-tab`);
  await waitFor(
    async () => (await anotherTab.locator("intentional-guard").count()) === 1,
    "new tab guard",
  );
  const anotherCdp = await context.newCDPSession(anotherTab);
  await waitFor(
    async () =>
      (await anotherCdp.send("Accessibility.getFullAXTree")).nodes.some(
        (node) => node.name?.value?.includes("left"),
      ),
    "new tab countdown",
  );
  assert.equal((await readState()).logs.length, 1);
  assert.equal((await readState()).sessions[ruleId].deadline, originalDeadline);
  await anotherTab.close();
  checks.push(
    "Refreshes, child documents, and new tabs share approval without extending the deadline",
  );
  await context.close();
  context = await launch();
  currentWorker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  settings = await context.newPage();
  settings.on("pageerror", (error) => failures.push(error.message));
  await settings.goto(`${appUrl}options.html`);
  page = await context.newPage();
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(`${base}/shorts/video`);
  await page.bringToFront();
  cdp = await context.newCDPSession(page);
  await cdp.send("Accessibility.enable");
  await waitFor(async () => (await ax()).includes("left"), "restart countdown");
  assert.equal((await ax()).includes("What brings you here?"), false);
  assert.equal((await readState()).sessions[ruleId].deadline, originalDeadline);
  checks.push(
    "Browser restart preserves intention approval and the original deadline",
  );
  await page.locator("#home").click();
  await page.waitForTimeout(800);
  await page.locator("#shorts").click();
  await waitFor(
    async () => (await ax()).includes("left"),
    "re-entry countdown",
  );
  assert.equal((await ax()).includes("What brings you here?"), false);
  assert.equal((await readState()).logs.length, 1);
  checks.push("Leaving and returning during the session does not ask again");
  await currentWorker.evaluate(async (id) => {
    const { state } = await chrome.storage.local.get("state");
    state.sessions[id].deadline = Date.now() + 31000;
    await chrome.storage.local.set({ state });
  }, ruleId);
  await waitFor(
    async () => (await ax()).includes("Wrap up your current work."),
    "30-second warning",
  );
  const warningTree = await ax();
  assert.ok(warningTree.includes("Session countdown"));
  assert.match(warningTree, /0m (?:30|[012]\d)s left/);
  const dismissWarning = async () => {
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    const close = nodes.find(
      (node) =>
        !node.ignored &&
        node.role?.value === "button" &&
        node.name?.value === "Dismiss warning",
    );
    assert.ok(close);
    const { object } = await cdp.send("DOM.resolveNode", {
      backendNodeId: close.backendDOMNodeId,
    });
    await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function() { this.click(); }",
    });
  };
  await page.waitForTimeout(1100);
  assert.notEqual(await ax(), warningTree);
  await page.screenshot({ path: "artifacts/thirty-second-warning.png" });
  await dismissWarning();
  const warningDeadline = (await readState()).sessions[ruleId].deadline;
  await waitFor(
    () => Date.now() >= warningDeadline - 9000,
    "final seconds without a second reminder",
    30000,
  );
  assert.equal((await ax()).includes("Wrap up your current work."), false);
  checks.push(
    "One 30-second warning counts down and stays dismissed through the final seconds",
  );
  await currentWorker.evaluate(async (id) => {
    const { state } = await chrome.storage.local.get("state");
    state.sessions[id].deadline = Date.now() - 1;
    await chrome.storage.local.set({ state });
  }, ruleId);
  await waitFor(
    async () => (await ax()).includes("Time to check in."),
    "session reflection",
    12000,
  );
  assert.equal(await readReason(), "Learn something useful");
  await page.waitForTimeout(250);
  await page.screenshot({ path: "artifacts/session-reflection.png" });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.waitForURL(/^chrome:\/\/(?:newtab|new-tab-page)\//);
  await page.goto(`${base}/shorts/return`);
  await waitFor(
    async () => (await ax()).includes("Time to check in."),
    "return after leaving expired session",
  );
  await page.waitForTimeout(100);
  assert.equal(await readReason(), "Learn something useful");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Finish this lesson");
  await page.keyboard.press("Tab");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("2");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitFor(
    async () => !(await ax()).includes("Time to check in."),
    "session renewal",
  );
  assert.equal((await readState()).logs[0].reason, "Finish this lesson");
  assert.ok((await readState()).sessions[ruleId].deadline > Date.now());
  await page.goto(`${base}/shorts/another`);
  await waitFor(
    async () => (await ax()).includes("left"),
    "renewed child document",
  );
  assert.equal(page.url(), `${base}/shorts/another`);
  checks.push(
    "Session expiry shows the original reason and allows an explicit renewal without network blocking",
  );
  await currentWorker.evaluate(async (id) => {
    const { state } = await chrome.storage.local.get("state");
    const date = new Date();
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    state.days[day] = { ...state.days[day], [id]: 600000 - 49000 };
    state.sessions[id].deadline = Date.now() - 1;
    const { runtime } = await chrome.storage.session.get("runtime");
    runtime.cursor = null;
    await chrome.storage.session.set({ runtime });
    await chrome.storage.local.set({ state });
  }, ruleId);
  await page.reload();
  await waitFor(
    async () => (await ax()).includes("Use remaining 49 sec"),
    "remaining seconds check-in",
  );
  assert.equal(await readReason(), "Finish this lesson");
  assert.equal((await ax()).includes("Time in minutes"), false);
  await clickGateButton("Use remaining 49 sec");
  await waitFor(
    async () => !(await ax()).includes("Time to check in."),
    "remaining time approval without retyping",
  );
  assert.equal((await readState()).logs[0].reason, "Finish this lesson");
  assert.equal((await readState()).logs[0].durationMs, 49000);
  checks.push(
    "Check-ins prefill editable reasons; remaining seconds continue in one click and retain the reason in Activity",
  );
  await currentWorker.evaluate(async (id) => {
    const { state } = await chrome.storage.local.get("state");
    const date = new Date();
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    state.days[day] ||= {};
    state.days[day][id] = 600000;
    await chrome.storage.local.set({ state });
  }, ruleId);
  await waitFor(
    async () => (await ax()).includes("Daily limit reached."),
    "daily lock",
    12000,
  );
  await page.goto(`${base}/shorts/locked`);
  await page.waitForURL(`${appUrl}blocked.html?rule=${ruleId}`);
  const unrelated = await context.newPage();
  await unrelated.goto(`${base}/shortstuff`);
  assert.equal(unrelated.url(), `${base}/shortstuff`);
  checks.push("Nearby paths outside the boundary stay accessible");
  await settings.bringToFront();
  await settings.reload();
  await settings.getByRole("tab", { name: "Activity" }).click();
  await settings.getByText("Learn something useful", { exact: true }).waitFor();
  await settings.screenshot({ path: "artifacts/activity.png", fullPage: true });
  await settings
    .getByRole("button", { name: "Clear day", exact: true })
    .click();
  await settings.locator("#confirm-action").click();
  await settings
    .getByRole("heading", { name: "No reasons for this period." })
    .waitFor();
  const cleared = await readState();
  assert.equal(cleared.logs.length, 0);
  assert.equal(cleared.days[Object.keys(cleared.days)[0]][ruleId], 600000);
  checks.push("Clear-day control deletes logs without unlocking the rule");
  await settings.getByRole("tab", { name: "Settings", exact: true }).click();
  await settings.locator("#strict-toggle").click();
  await settings
    .getByRole("button", { name: "Disable guard", exact: true })
    .waitFor();
  const manager = await context.newPage();
  await manager.goto("chrome://extensions/").catch(() => {});
  await manager.waitForURL(`${appUrl}strict.html`);
  checks.push(
    "Optional extension-page guard redirects chrome://extensions after explicit enablement",
  );
  await manager.locator("#disable-guard").click();
  await manager.waitForURL("chrome://extensions/");
  assert.equal((await readState()).settings.strictMode, false);
  await manager.waitForTimeout(600);
  assert.equal(manager.url(), "chrome://extensions/");
  checks.push(
    "The reminder offers one-click guard removal and opens the Chrome extension manager",
  );
  await settings.getByRole("tab", { name: "Limits" }).click();
  await settings.locator("#add-rule").click();
  await settings.locator("#target").fill("localhost/focus");
  await settings.locator("#label").fill("Daily focus boundary");
  await settings.locator("#dailyMinutes").fill("1");
  await settings.locator("#intentionalVisits").uncheck();
  await settings.locator("#preventOverrides").check();
  await settings.locator("#save-rule").click();
  await settings
    .getByRole("heading", { name: "Daily focus boundary", exact: true })
    .waitFor();
  const dailyRule = (await readState()).rules.find(
    (rule) => rule.label === "Daily focus boundary",
  );
  await currentWorker.evaluate(async (id) => {
    const { state } = await chrome.storage.local.get("state");
    const date = new Date();
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    state.days[day] ||= {};
    state.days[day][id] = 57000;
    await chrome.storage.local.set({ state });
  }, dailyRule.id);
  await page.goto(`${base}/focus`);
  await page.bringToFront();
  await waitFor(
    async () => (await ax()).includes("Wrap up your current work."),
    "final daily warning",
  );
  await page.screenshot({ path: "artifacts/warning.png" });
  await waitFor(
    async () => (await ax()).includes("Daily limit reached."),
    "daily usage lock",
    12000,
  );
  await page.goto(`${base}/focus/again`);
  await page.waitForURL(`${appUrl}blocked.html?rule=${dailyRule.id}`);
  checks.push(
    "Active daily usage warns near the deadline, locks the page, and redirects re-entry",
  );
  await settings.bringToFront();
  await settings.locator("#add-rule").click();
  await settings.locator("#target").fill("localhost/reflect");
  await settings.locator("#label").fill("Reading boundary");
  await settings.locator("#dailyMinutes").fill("1");
  await settings.locator("#intentionalVisits").uncheck();
  await settings
    .locator("#message")
    .fill("Is this still worth your attention?");
  await settings.locator("#save-rule").click();
  await settings
    .getByRole("heading", { name: "Reading boundary", exact: true })
    .waitFor();
  const reflectionRule = (await readState()).rules.find(
    (rule) => rule.label === "Reading boundary",
  );
  assert.equal(reflectionRule.overrideMinutes, undefined);
  const exhaust = async () =>
    currentWorker.evaluate(async (id) => {
      const { state } = await chrome.storage.local.get("state");
      const date = new Date();
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      state.days[day] ||= {};
      state.days[day][id] = 60000;
      await chrome.storage.local.set({ state });
    }, reflectionRule.id);
  await exhaust();
  await page.goto(`${base}/reflect/article`);
  await page.bringToFront();
  await openExtraTime(1);
  await clickGateButton("Back");
  assert.equal((await ax()).includes("Time in minutes"), false);
  await page.reload();
  await openExtraTime(1);
  assert.ok((await ax()).includes("Is this still worth your attention?"));
  assert.equal((await ax()).includes("Time in minutes"), true);
  await page.waitForTimeout(150);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  assert.equal((await readState()).overrides[reflectionRule.id], undefined);
  await page.keyboard.type("Finish the paragraph");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitFor(
    async () => !(await ax()).includes("Reason"),
    "override approval",
  );
  const overrideDeadline = (await readState()).overrides[reflectionRule.id]
    .deadline;
  await page.reload();
  await waitFor(async () => (await ax()).includes("left"), "override reload");
  await page.goto(`${base}/reflect/child`);
  await waitFor(async () => (await ax()).includes("left"), "override child");
  assert.equal(
    (await readState()).overrides[reflectionRule.id].deadline,
    overrideDeadline,
  );
  assert.equal(
    (await readState()).logs.filter((log) => log.type === "override").length,
    1,
  );
  const expireOverride = async () =>
    currentWorker.evaluate(async (id) => {
      const { state } = await chrome.storage.local.get("state");
      state.overrides[id].deadline = Date.now() - 1;
      await chrome.storage.local.set({ state });
    }, reflectionRule.id);
  await expireOverride();
  await openExtraTime(2);
  await page.waitForTimeout(150);
  assert.equal(await readReason(), "Finish the paragraph");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Read the conclusion");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitFor(
    async () => !(await ax()).includes("Reason"),
    "second override approval",
  );
  assert.equal((await readState()).logs[0].attempts[0].attempt, 2);
  await settings.bringToFront();
  await settings.reload();
  await settings.getByRole("tab", { name: "Activity" }).click();
  await settings.getByText("Override #2", { exact: true }).waitFor();
  await settings.getByText("Read the conclusion", { exact: true }).waitFor();
  await settings.screenshot({
    path: "artifacts/override-activity.png",
    fullPage: true,
  });
  const clearButtons = settings.getByRole("button", {
    name: "Clear day",
    exact: true,
  });
  await clearButtons.first().click();
  await settings.locator("#confirm-action").click();
  await waitFor(
    async () => (await readState()).logs.length === 0,
    "log deletion saved",
  );
  assert.equal(
    Object.values((await readState()).overrideCounts)[0][reflectionRule.id],
    2,
  );
  await page.bringToFront();
  await settings.evaluate(() =>
    chrome.runtime.sendMessage({ type: "DASHBOARD" }),
  );
  await page.waitForTimeout(300);
  await expireOverride();
  await waitFor(
    async () => {
      const current = await readState();
      if (current.overrides[reflectionRule.id].deadline > Date.now())
        await expireOverride();
      return (await ax()).includes("Daily limit reached.");
    },
    "counter survives clearing logs",
    12000,
  );
  await page.screenshot({
    path: "artifacts/daily-limit-first.png",
    animations: "disabled",
  });
  await openExtraTime(3);
  await page.waitForTimeout(200);
  await page.screenshot({ path: "artifacts/override-prompt.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/override-prompt-mobile.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await readReason(), "Read the conclusion");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("One last section");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitFor(
    async () => !(await ax()).includes("Reason"),
    "third override approval",
  );
  checks.push(
    "Configured overrides require reasons, survive refreshes, re-prompt on expiry, and retain numbered history after clearing logs",
  );
  await settings.bringToFront();
  await settings.getByRole("tab", { name: "Limits" }).click();
  await settings
    .getByRole("button", { name: "Edit Reading boundary", exact: true })
    .click();
  assert.equal(await settings.locator("#overrideMinutes").count(), 0);
  await settings.locator("#preventOverrides").check();
  await settings.locator("#save-rule").click();
  await settings.locator("#rule-dialog").waitFor({ state: "hidden" });
  await page.goto(`${base}/reflect/strict`);
  await page.waitForURL(`${appUrl}blocked.html?rule=${reflectionRule.id}`);
  await page
    .getByText("Is this still worth your attention?", { exact: true })
    .waitFor();
  assert.equal(await page.getByRole("button", { name: /Continue/ }).count(), 0);
  await page.screenshot({ path: "artifacts/strict-limit.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/strict-limit-mobile.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  checks.push(
    "Prevent overrides revokes an active override and the compact limit screen shows the custom reminder",
  );
  const beforeClear = await readState();
  await settings.bringToFront();
  await settings.getByRole("tab", { name: "Activity" }).click();
  await settings.getByRole("tab", { name: "Settings", exact: true }).click();
  const exportWait = settings.waitForEvent("download");
  await settings.locator("#export-data").click();
  const exported = await exportWait;
  await exported.saveAs("artifacts/export.json");
  const exportedData = JSON.parse(
    await readFile("artifacts/export.json", "utf8"),
  );
  assert.equal(exportedData.rules.length, beforeClear.rules.length);
  assert.equal(
    exportedData.days[Object.keys(exportedData.days)[0]][dailyRule.id],
    60000,
  );
  checks.push("Export produces readable JSON with rules and daily usage");
  await settings.getByRole("tab", { name: "Limits" }).click();
  await settings.setViewportSize({ width: 390, height: 844 });
  await settings.screenshot({
    path: "artifacts/settings-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await settings.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  checks.push("Settings fit a narrow viewport without horizontal overflow");
  await settings.setViewportSize({ width: 1280, height: 900 });
  await settings.getByRole("tab", { name: "Settings", exact: true }).click();
  await settings.locator("#clear-data").click();
  await settings.locator("#confirm-action").click();
  await settings.getByRole("tab", { name: "Limits" }).click();
  await settings.getByRole("heading", { name: "No limits yet." }).waitFor();
  const erased = await readState();
  assert.deepEqual(erased.rules, []);
  assert.deepEqual(erased.overrides, {});
  assert.deepEqual(erased.overrideCounts, {});
  assert.deepEqual(erased.overtimeDays, {});
  assert.deepEqual(
    await currentWorker.evaluate(() =>
      chrome.declarativeNetRequest.getDynamicRules(),
    ),
    [],
  );
  checks.push("Erase all data removes rules and Chrome network blocks");

  assert.deepEqual(failures, []);
  await writeFile(
    "artifacts/browser-results.json",
    JSON.stringify({ checks, failures }, null, 2),
  );
  console.log(checks.map((check) => `PASS ${check}`).join("\n"));
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
