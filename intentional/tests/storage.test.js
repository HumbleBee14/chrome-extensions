import test from "node:test";
import assert from "node:assert/strict";
import { createState } from "../extension/core/engine.js";
import { readState } from "../extension/background/storage.js";

test("loading older rules shortens names and notes without changing targets or historical logs", async () => {
  const state = createState();
  state.rules = [
    {
      id: "r1",
      label: "x".repeat(80),
      message: "m".repeat(240),
      messageColor: "#a13d36",
      target: "example.com/long-original-target",
    },
  ];
  state.logs = [{ labels: ["x".repeat(80)] }];
  globalThis.chrome = {
    storage: {
      local: { get: async () => ({ state: structuredClone(state) }) },
    },
  };
  const loaded = await readState();
  assert.equal(loaded.rules[0].label, "x".repeat(32));
  assert.equal(loaded.rules[0].message, "m".repeat(160));
  assert.equal(loaded.rules[0].messageColor, "#e5252a");
  assert.equal(loaded.rules[0].target, "example.com/long-original-target");
  assert.equal(loaded.logs[0].labels[0], "x".repeat(80));
});

test("extension updates preserve existing, empty, and older custom reason settings", async () => {
  for (const presets of [["My own choice"], []]) {
    const state = createState();
    state.settings = { strictMode: true, reasonPresets: presets };
    state.rules = [
      {
        id: "r1",
        label: "Reading",
        target: "example.com",
        presetMode: "custom",
        reasonPresets: ["A previously saved long reason"],
        useSavedReasons: true,
      },
    ];
    globalThis.chrome = {
      storage: {
        local: { get: async () => ({ state: structuredClone(state) }) },
      },
    };
    const loaded = await readState();
    assert.deepEqual(loaded.settings, state.settings);
    assert.deepEqual(
      loaded.rules[0].reasonPresets,
      state.rules[0].reasonPresets,
    );
  }
  globalThis.chrome = { storage: { local: { get: async () => ({}) } } };
  assert.ok((await readState()).settings.reasonPresets.includes("Quick Check"));
});
