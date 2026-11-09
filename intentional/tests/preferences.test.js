import test from "node:test";
import assert from "node:assert/strict";
import * as preferences from "../extension/core/preferences.js";
import { normalizeRule } from "../extension/core/rules.js";
import { createState, evaluate } from "../extension/core/engine.js";

const rule = (extra = {}) =>
  normalizeRule({
    id: "r1",
    target: "example.com/read",
    mode: "prefix",
    dailyMinutes: 20,
    ...extra,
  });
test("reason presets trim and deduplicate without silently accepting oversized lists or labels", () => {
  assert.deepEqual(
    preferences.normalizePresets([
      " Research ",
      "",
      "research",
      "Casual browsing",
    ]),
    ["Research", "Casual browsing"],
  );
  assert.throws(() => preferences.normalizePresets(["x".repeat(21)]), /16/);
  const reasons = Array.from({ length: 10 }, (_, index) => `Reason ${index}`);
  assert.deepEqual(preferences.normalizePresets(reasons), reasons);
  assert.throws(
    () => preferences.normalizePresets([...reasons, "Eleventh"]),
    /10/,
  );
});
test("all websites use common reasons while legacy lists stay intact", () => {
  const state = createState();
  state.settings.reasonPresets = ["Research", "Casual browsing"];
  state.rules = [
    rule(),
    rule({
      id: "specific",
      target: "example.com/read/books",
      presetMode: "custom",
      reasonPresets: ["Find a book"],
    }),
  ];
  assert.deepEqual(evaluate(state, "https://example.com/read").reasonPresets, [
    "Research",
    "Casual browsing",
  ]);
  assert.deepEqual(
    evaluate(state, "https://example.com/read/books").reasonPresets,
    ["Research", "Casual browsing"],
  );
  state.settings.reasonPresets = [];
  assert.deepEqual(
    evaluate(state, "https://example.com/read/books").reasonPresets,
    [],
  );
  assert.deepEqual(state.rules[1].reasonPresets, ["Find a book"]);
});
test("one intentional-visit setting controls reason and timer without losing legacy settings on read", () => {
  const enabled = rule({ intentionalVisits: true });
  assert.equal(enabled.requireReason, true);
  assert.equal(enabled.requireSession, true);
  const disabled = rule({
    intentionalVisits: false,
    requireReason: true,
    requireSession: true,
  });
  assert.equal(disabled.requireReason, false);
  assert.equal(disabled.requireSession, false);
  const legacy = rule({ requireSession: true });
  assert.equal(legacy.intentionalVisits, true);
  assert.equal(legacy.requireReason, false);
});
test("message colors default to black and accept only the readable palette", () => {
  assert.equal(rule().messageColor, "#27372f");
  assert.equal(rule({ messageColor: "#2456a6" }).messageColor, "#0969ff");
  assert.equal(
    rule({ messageColor: "url(https://example.com)" }).messageColor,
    "#27372f",
  );
});

test("message notes are capped at 160 characters and older color choices keep their hue", () => {
  assert.equal(rule({ message: "m".repeat(240) }).message, "m".repeat(160));
  assert.equal(rule({ message: "m".repeat(160) }).message.length, 160);
  assert.equal(rule({ messageColor: "#a13d36" }).messageColor, "#e5252a");
});

test("existing longer reason choices are preserved but new or edited choices stay short", () => {
  const existing = "A previously saved long reason";
  assert.deepEqual(preferences.normalizePresets([existing], [existing]), [
    existing,
  ]);
  assert.throws(() => preferences.normalizePresets([existing]), /16/);
  assert.throws(
    () => preferences.normalizePresets([existing + "!"], [existing]),
    /16/,
  );
});
test("legacy per-site opt-outs do not override the common list", () => {
  const state = createState();
  state.settings.reasonPresets = ["Quick Check"];
  state.rules = [
    rule({
      useSavedReasons: false,
      presetMode: "custom",
      reasonPresets: ["Find a book"],
    }),
  ];
  assert.deepEqual(evaluate(state, "https://example.com/read").reasonPresets, [
    "Quick Check",
  ]);
  assert.deepEqual(state.rules[0].reasonPresets, ["Find a book"]);
});
