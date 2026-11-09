import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploy } from "./chrome-web-store.mjs";
import { packageExtension } from "./package-extension.mjs";

const base = {
  action: "upload",
  publisherId: "publisher-123",
  extensionId: "a".repeat(32),
  accessToken: "access-secret",
  packageBytes: Buffer.from("ZIP"),
  version: "1.2.0",
  sleep: async () => {},
};
function api(responses) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      assert.ok(responses.length, "unexpected API request");
      const { status = 200, ...body } = responses.shift();
      return { ok: status < 400, status, json: async () => body };
    },
  };
}
test("both packages contain their own root manifest and license, without repository or development files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chrome-packages-"));
  try {
    for (const slug of ["vblur", "intentional"]) {
      const output = await packageExtension(slug, dir);
      const entries = execFileSync("unzip", ["-Z1", output], {
        encoding: "utf8",
      })
        .trim()
        .split("\n");
      assert.ok(entries.includes("manifest.json"));
      assert.ok(entries.includes("LICENSE"));
      assert.ok(
        entries.every(
          (name) =>
            !/(^|\/)(\.git[^/]*|node_modules|tests|docs|scripts|artifacts|original icon)(\/|$)/.test(
              name,
            ),
        ),
      );
      assert.ok(entries.every((name) => !name.startsWith(`${slug}/`)));
      const manifest = JSON.parse(
        execFileSync("unzip", ["-p", output, "manifest.json"], {
          encoding: "utf8",
        }),
      );
      assert.equal(manifest.name, slug === "vblur" ? "VBlur" : "Intentional");
      const refs = [
        manifest.background?.service_worker,
        manifest.action?.default_popup,
        manifest.options_page,
        ...Object.values(manifest.icons || {}),
        ...(manifest.content_scripts || []).flatMap((script) => [
          ...(script.js || []),
          ...(script.css || []),
        ]),
      ].filter(Boolean);
      for (const ref of refs)
        assert.ok(entries.includes(ref), `${slug}: missing ${ref}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("status only reads the selected item", async () => {
  const mock = api([{ publishedItemRevisionStatus: { state: "PUBLISHED" } }]);
  const result = await deploy({
    ...base,
    ...mock,
    action: "status",
    packageBytes: undefined,
  });
  assert.equal(result.publishedItemRevisionStatus.state, "PUBLISHED");
  assert.equal(mock.calls.length, 1);
  assert.ok(
    mock.calls[0].url.endsWith(`/items/${base.extensionId}:fetchStatus`),
  );
  assert.equal(mock.calls[0].headers.Authorization, "Bearer access-secret");
});

test("draft upload polls async processing and never submits", async () => {
  const mock = api([
    {},
    { uploadState: "IN_PROGRESS" },
    { lastAsyncUploadState: "IN_PROGRESS" },
    { lastAsyncUploadState: "SUCCEEDED" },
  ]);
  const result = await deploy({ ...base, ...mock });
  assert.equal(result.uploadState, "SUCCEEDED");
  assert.equal(
    mock.calls.filter((call) => call.url.endsWith(":publish")).length,
    0,
  );
  const upload = mock.calls.find((call) => call.url.endsWith(":upload"));
  assert.equal(upload.method, "POST");
  assert.equal(upload.headers["Content-Type"], "application/zip");
  assert.equal(upload.body, base.packageBytes);
});

test("explicit submit only follows a successful upload and blocks warnings", async () => {
  const mock = api([
    {},
    { uploadState: "SUCCEEDED", crxVersion: base.version },
    { state: "PENDING_REVIEW" },
  ]);
  assert.equal(
    (await deploy({ ...base, ...mock, action: "submit" })).state,
    "PENDING_REVIEW",
  );
  assert.deepEqual(JSON.parse(mock.calls.at(-1).body), {
    publishType: "DEFAULT_PUBLISH",
    skipReview: false,
    blockOnWarnings: true,
  });
});

test("failed, unknown, and timed-out uploads cannot submit", async () => {
  for (const state of ["FAILED", "NOT_FOUND", undefined, "IN_PROGRESS"]) {
    const mock = api([{}, { uploadState: state }]);
    await assert.rejects(
      deploy({ ...base, ...mock, action: "submit", attempts: 0 }),
      /Upload did not complete/,
    );
    assert.equal(mock.calls.length, 2);
  }
});

test("already published versions are rejected before any upload", async () => {
  const mock = api([
    {
      publishedItemRevisionStatus: {
        distributionChannels: [{ crxVersion: base.version }],
      },
    },
  ]);
  await assert.rejects(deploy({ ...base, ...mock }), /already published/);
  assert.equal(mock.calls.length, 1);
});

test("missing setup and invalid extension IDs fail before any API request", async () => {
  for (const extra of [
    { publisherId: "" },
    { extensionId: "" },
    { accessToken: "" },
    { action: "bad" },
  ]) {
    const mock = api([]);
    await assert.rejects(deploy({ ...base, ...mock, ...extra }));
    assert.equal(mock.calls.length, 0);
  }
});

test("authentication errors report an actionable code without exposing credentials", async () => {
  const mock = api([
    {
      status: 400,
      error: "invalid_grant",
      error_description: "secret refresh access-secret",
    },
  ]);
  await assert.rejects(deploy({ ...base, ...mock }), (error) => {
    assert.match(error.message, /invalid_grant/);
    assert.doesNotMatch(error.message, /secret|refresh/);
    return true;
  });
});
