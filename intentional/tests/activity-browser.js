import { setChoices, choices } from "./preset-helpers.js";
import { chromium } from "playwright";
import { mkdtemp, cp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const profile = await mkdtemp(join(tmpdir(), "intentional-activity-"));
const extension = join(profile, "extension");
await cp(resolve("extension"), extension, { recursive: true });
let context;
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
  const appUrl = `chrome-extension://${new URL(worker.url()).host}/ui/options.html?panel=activity`;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(appUrl);
  await page.locator("#activity-date").waitFor({ state: "visible" });
  const dates = await page.evaluate(async () => {
    const { createState, dayKey } = await import(
      chrome.runtime.getURL("core/engine.js")
    );
    const { shiftDay } = await import(
      chrome.runtime.getURL("core/activity.js")
    );
    const state = createState();
    const today = dayKey();
    const yesterday = shiftDay(today, -1);
    state.activitySince = new Date(
      `${shiftDay(today, -20)}T00:00:00`,
    ).getTime();
    state.activeDays = { [today]: 300000, [yesterday]: 600000 };
    state.activeOvertimeDays = { [yesterday]: 120000 };
    state.overrideCounts = { [yesterday]: { a: 2 } };
    state.logs = [
      {
        id: "today",
        at: new Date(`${today}T09:00:00`).getTime(),
        labels: ["Example"],
        reason: "Today reason",
        minutes: 5,
      },
      ...[1, 2, 3].map((id) => ({
        id: String(id),
        at: new Date(`${yesterday}T09:00:00`).getTime(),
        labels: ["Example"],
        reason: `Yesterday reason ${id}`,
        minutes: 5,
      })),
      {
        id: "override",
        at: new Date(`${yesterday}T10:00:00`).getTime(),
        type: "override",
        labels: ["Example"],
        reason: "Need to finish",
        attempts: [{ label: "Example", minutes: 10, attempt: 2 }],
      },
    ];
    await chrome.storage.local.set({ state });
    return { today, yesterday };
  });
  await page.reload();
  await page.getByText("Today reason", { exact: true }).waitFor();
  assert.equal(await page.locator("#session-count").textContent(), "1");
  assert.equal(await page.locator("#active-time").textContent(), "5m");
  await page.locator("#activity-date").fill(dates.yesterday);
  await page.locator("#activity-date").dispatchEvent("change");
  assert.equal(await page.locator("#session-count").textContent(), "3");
  assert.equal(await page.locator("#override-count").textContent(), "2");
  assert.equal(await page.locator("#active-time").textContent(), "10m");
  assert.equal(await page.locator("#overtime-time").textContent(), "2m");
  assert.equal(
    await page.getByText("Today reason", { exact: true }).count(),
    0,
  );
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await page.locator("#activity-week").click();
    assert.equal(await page.locator(".week-day").count(), 7);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await mkdir("artifacts", { recursive: true });
    await page.screenshot({
      path: `artifacts/activity-week-${width}.png`,
      fullPage: true,
    });
    const dayLabel = new Date(`${dates.yesterday}T12:00:00`).toLocaleDateString(
      "en-US",
      { weekday: "short", day: "numeric" },
    );
    await page.locator(".week-day").filter({ hasText: dayLabel }).click();
    assert.equal(
      await page.locator("#activity-date").inputValue(),
      dates.yesterday,
    );
    assert.equal(await page.locator("#session-count").textContent(), "3");
  }
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-logs").click();
  const download = await downloadPromise;
  const { readFile } = await import("node:fs/promises");
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.length, 4);
  await page.locator("#clear-logs").click();
  await page.locator("#confirm-action").click();
  await page
    .getByRole("heading", { name: "No reasons for this period." })
    .waitFor();
  assert.equal(await page.locator("#active-time").textContent(), "10m");
  assert.equal(await page.locator("#override-count").textContent(), "2");
  await page.locator("#activity-date").fill(dates.today);
  await page.locator("#activity-date").dispatchEvent("change");
  await page.getByText("Today reason", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await setChoices(page, "global-presets", ["Quick Check"]);
  const reason = page.locator("#global-presets input[data-reason]").first();
  await reason.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#global-presets input[data-reason]").length ===
      2,
  );
  assert.deepEqual(await choices(page, "global-presets"), ["Quick Check", ""]);
  assert.equal(
    await page
      .locator("#global-presets input[data-reason]")
      .last()
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.deepEqual(
    await page.evaluate(
      async () =>
        (await chrome.storage.local.get("state")).state.settings.reasonPresets,
    ),
    ["Quick Check"],
  );
  await page.screenshot({ path: "artifacts/reason-input-focus.png" });
  await page
    .locator("#global-presets input[data-reason]")
    .last()
    .fill("Research");
  await page
    .locator("#global-presets input[data-reason]")
    .last()
    .press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#global-presets input[data-reason]").length ===
      3,
  );
  await page.reload();
  await page.locator("#global-presets input[data-reason]").first().waitFor();
  assert.deepEqual(await choices(page, "global-presets"), [
    "Quick Check",
    "Research",
  ]);
  await page.getByRole("tab", { name: "Limits", exact: true }).click();
  await page.locator("#add-rule").click();
  assert.equal(await page.locator("#preset-mode").count(), 0);
  assert.equal(
    await page.locator("#rule-dialog").evaluate((el) => el.open),
    true,
  );
  assert.equal(
    await page.evaluate(
      async () => (await chrome.storage.local.get("state")).state.rules.length,
    ),
    0,
  );
  await page.goto(appUrl);
  await page.evaluate(async () => {
    const { state } = await chrome.storage.local.get("state");
    state.logs = Array.from({ length: 70 }, (_, index) => ({
      id: `compact-${index}`,
      at: Date.now() - index * 1000,
      labels: ["Reading"],
      reason: `Compact reason ${index}`,
      minutes: 5,
    }));
    await chrome.storage.local.set({ state });
  });
  await page.reload();
  await page.locator(".log-item").first().waitFor();
  assert.equal(await page.locator(".log-item").count(), 50);
  assert.equal(
    await page
      .locator(".log-scroll")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
    true,
  );
  await page.locator(".log-line").first().click();
  assert.equal(await page.locator(".log-item[open]").count(), 1);
  await page.getByText("Reason: Compact reason 0", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Older", exact: true }).click();
  assert.equal(await page.locator(".log-item").count(), 20);
  await page.getByRole("button", { name: "Newer", exact: true }).click();
  assert.equal(await page.locator(".log-item").count(), 50);
  assert.equal(
    await page.evaluate(
      async () => (await chrome.storage.local.get("state")).state.logs.length,
    ),
    70,
  );
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 720 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.ok(
      (await page
        .locator(".log-line")
        .first()
        .evaluate((el) => el.getBoundingClientRect().height)) <= 50,
    );
    await page.screenshot({ path: `artifacts/activity-compact-${width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS Day/Week metrics, day drilldown, scoped export/clear, retained totals, and desktop/mobile layout",
  );
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
