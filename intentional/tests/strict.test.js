import test from "node:test";
import assert from "node:assert/strict";
import { shouldGuard } from "../extension/core/strict.js";

test("extension manager guard is off by default", () => {
  assert.equal(shouldGuard({}, "chrome://extensions/"), false);
});

test("guard targets Chrome extension settings without blocking other settings", () => {
  const settings = { strictMode: true };
  for (const url of [
    "chrome://extensions",
    "chrome://extensions/",
    "chrome://extensions/?id=abc",
    "chrome://extensions/shortcuts",
    "chrome://settings/extensions",
  ])
    assert.equal(shouldGuard(settings, url), true);
  for (const url of [
    "chrome://settings/",
    "chrome://settings/privacy",
    "https://example.com/chrome://extensions",
    "chrome://version/",
  ])
    assert.equal(shouldGuard(settings, url), false);
});
