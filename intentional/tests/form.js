import { chromium } from "playwright";
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const profile = await mkdtemp(join(tmpdir(), "intentional-form-"));
const extension = join(profile, "extension");
await cp(resolve("extension"), extension, { recursive: true });
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions = ["http://*.localhost/*", "https://*.localhost/*"];
await writeFile(manifestPath, JSON.stringify(manifest));
let context;
async function checkLayout(page, mode) {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 667 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.locator("#rule-dialog").evaluate((dialog) => {
      const box = dialog.getBoundingClientRect();
      const save = document.getElementById("save-rule").getBoundingClientRect();
      const close = document
        .getElementById("close-rule")
        .getBoundingClientRect();
      return {
        scrolls: dialog.scrollHeight > dialog.clientHeight + 1,
        scrollOverflow: dialog.scrollHeight - dialog.clientHeight,
        inside:
          box.top >= 0 &&
          box.bottom <= innerHeight &&
          box.left >= 0 &&
          box.right <= innerWidth,
        actionsVisible:
          save.bottom <= box.bottom &&
          save.top >= box.top &&
          close.top >= box.top,
        horizontalOverflow: dialog.scrollWidth > dialog.clientWidth,
      };
    });
    await page.screenshot({
      path: `artifacts/${mode}-limit-${viewport.width}.png`,
    });
    assert.equal(
      layout.inside,
      true,
      `${mode} stays within ${viewport.width}x${viewport.height}`,
    );
    assert.equal(
      layout.actionsVisible,
      true,
      `${mode} save controls stay visible`,
    );
    assert.equal(
      layout.horizontalOverflow,
      false,
      `${mode} has no horizontal overflow`,
    );
    assert.equal(
      layout.scrolls,
      false,
      `Default form fits without scrolling at ${viewport.width}x${viewport.height} (overflow ${layout.scrollOverflow}px)`,
    );
  }
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
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const appUrl = `chrome-extension://${new URL(worker.url()).host}/ui/options.html`;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(appUrl);
  await page.locator("#add-rule").click();
  assert.equal(
    await page.locator("#label").evaluate((input) => input.form.id),
    "rule-form",
  );
  await mkdir("artifacts", { recursive: true });
  const intentionalInfo = page.getByRole("button", {
    name: "About intentional visits",
    exact: true,
  });
  await intentionalInfo.hover();
  await page.locator("#intentional-visits-help").waitFor({ state: "visible" });
  assert.equal(await page.locator("#intentionalVisits").isChecked(), true);
  await page.mouse.move(1, 1);
  await page.locator("#intentional-visits-help").waitFor({ state: "hidden" });
  await intentionalInfo.focus();
  await page.locator("#intentional-visits-help").waitFor({ state: "visible" });
  await page.locator("#target").focus();
  await page
    .getByRole("button", { name: "About prevent overrides", exact: true })
    .click();
  await page.locator("#prevent-overrides-help").waitFor({ state: "visible" });
  assert.equal(await page.locator("#preventOverrides").isChecked(), false);
  await page.keyboard.press("Escape");
  await page.locator("#prevent-overrides-help").waitFor({ state: "hidden" });
  assert.equal(
    await page.locator("#rule-dialog").evaluate((dialog) => dialog.open),
    true,
  );
  await checkLayout(page, "add");
  await page.locator("#label").fill("n".repeat(80));
  assert.equal(await page.locator("#label").inputValue(), "n".repeat(32));
  await page.locator("#label").press("End");
  await page.keyboard.type("extra characters");
  assert.equal(await page.locator("#label").inputValue(), "n".repeat(32));
  await page.locator("#label").fill("Discard this name");
  await page.locator("#cancel-rule").click();
  await page.locator("#add-rule").click();
  assert.equal(await page.locator("#label").inputValue(), "");
  await page.locator("#target").fill("localhost/focus");
  await page.locator("#label").fill("Reading");
  await page.locator("#message").fill("m".repeat(240));
  assert.equal(await page.locator("#message").inputValue(), "m".repeat(160));
  assert.equal(await page.locator("#message-count").textContent(), "160/160");
  await page.locator("#message").fill("Make this time count.");
  assert.equal(
    await page
      .locator("#message")
      .evaluate((input) => getComputedStyle(input).fontWeight),
    "700",
  );
  assert.equal(await page.locator("#preset-mode").count(), 0);
  await page.locator("#message-color-picker > summary").click();
  await page.locator('.color-choice[title="Blue"]').click();
  assert.equal(
    await page
      .locator("#message")
      .evaluate((input) => getComputedStyle(input).color),
    "rgb(9, 105, 255)",
  );
  await page.locator("#save-rule").click();
  await page.locator("#rule-dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Edit Reading", exact: true }).click();
  assert.equal(await page.locator("#label").inputValue(), "Reading");
  assert.equal(
    await page.locator("#message").inputValue(),
    "Make this time count.",
  );
  assert.equal(
    await page.locator('input[name="messageColor"]:checked').inputValue(),
    "#0969ff",
  );
  await checkLayout(page, "edit");
  assert.deepEqual(errors, []);
  console.log(
    "PASS Readable Add/Edit forms stay within desktop and mobile viewports with visible Save controls",
  );
  console.log(
    "PASS Name/note caps, bold bright colors, and hover/focus/click info hints work",
  );
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
