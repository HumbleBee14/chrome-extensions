import test from "node:test";
import assert from "node:assert/strict";
import { isSettingsSender } from "../extension/core/messages.js";

const id = "test-extension";
const base = `chrome-extension://${id}/`;

test("settings pages opened in tabs can manage rules", () => {
  assert.equal(
    isSettingsSender(
      { id, url: `${base}ui/options.html`, tab: { id: 1 } },
      id,
      base,
    ),
    true,
  );
  assert.equal(
    isSettingsSender({ id, url: `${base}ui/popup.html` }, id, base),
    true,
  );
});

test("web pages and other extensions cannot manage rules or read logs", () => {
  assert.equal(
    isSettingsSender(
      { id, url: "https://example.com", tab: { id: 1 } },
      id,
      base,
    ),
    false,
  );
  assert.equal(
    isSettingsSender({ id: "other", url: `${base}ui/options.html` }, id, base),
    false,
  );
  assert.equal(
    isSettingsSender({ id, url: `${base}ui/missing.html` }, id, base),
    false,
  );
});

test("embedded extension pages cannot manage settings", () => {
  assert.equal(
    isSettingsSender(
      { id, url: `${base}ui/blocked.html`, frameId: 1 },
      id,
      base,
    ),
    false,
  );
});
