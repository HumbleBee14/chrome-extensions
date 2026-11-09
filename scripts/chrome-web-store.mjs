import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { extensions, repoRoot } from "./package-extension.mjs";

const API = "https://chromewebstore.googleapis.com";
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// Credentials stay in environment variables and are never printed or passed as CLI arguments.
export async function deploy({
  action,
  publisherId,
  extensionId,
  accessToken,
  packageBytes,
  version,
  fetchImpl = fetch,
  sleep = wait,
  attempts = 24,
}) {
  if (!["status", "upload", "submit"].includes(action))
    throw new Error("Choose status, upload, or submit.");
  if (!/^[a-zA-Z0-9_-]+$/.test(publisherId || ""))
    throw new Error(
      "Set CHROME_WEBSTORE_PUBLISHER_ID in repository variables.",
    );
  if (!/^[a-p]{32}$/.test(extensionId || ""))
    throw new Error(
      "Set the selected extension’s 32-character Chrome Web Store ID.",
    );
  if (!accessToken)
    throw new Error(
      "Authenticate using the GitHub Actions Google auth step first.",
    );
  if (action !== "status" && (!packageBytes?.length || !version))
    throw new Error("Build the selected extension ZIP before uploading.");
  const request = async (url, options = {}) => {
    const response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(120000),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        `Chrome Web Store returned a non-JSON response (HTTP ${response.status}).`,
      );
    }
    if (!response.ok || result.error) {
      // Do not echo Google response bodies: OAuth errors can contain credential material.
      const code =
        typeof result.error === "string" ? result.error : result.error?.status;
      const safeCode = /^[A-Z_0-9]+$/i.test(code || "") ? ` ${code}` : "";
      throw new Error(
        `Chrome Web Store request failed (HTTP ${response.status}${safeCode}). Check service-account access and the Developer Dashboard.`,
      );
    }
    return result;
  };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const item = `publishers/${publisherId}/items/${extensionId}`;
  const statusUrl = `${API}/v2/${item}:fetchStatus`;
  const before = await request(statusUrl, { headers });
  if (action === "status") return before;
  const published =
    before.publishedItemRevisionStatus?.distributionChannels || [];
  if (published.some((channel) => channel.crxVersion === version))
    throw new Error(
      `Version ${version} is already published. Increase manifest.version before uploading.`,
    );
  const upload = await request(`${API}/upload/v2/${item}:upload`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/zip" },
    body: packageBytes,
  });
  let state = upload.uploadState;
  for (
    let attempt = 0;
    ["IN_PROGRESS", "UPLOAD_IN_PROGRESS"].includes(state) && attempt < attempts;
    attempt++
  ) {
    await sleep(5000);
    state = (await request(statusUrl, { headers })).lastAsyncUploadState;
  }
  if (state !== "SUCCEEDED")
    throw new Error(
      `Upload did not complete successfully (${state || "unknown state"}). Check the Developer Dashboard before retrying.`,
    );
  if (upload.crxVersion && upload.crxVersion !== version)
    throw new Error("Uploaded version does not match the selected manifest.");
  if (action === "upload") return { uploadState: state, crxVersion: version };
  return request(`${API}/v2/${item}:publish`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      publishType: "DEFAULT_PUBLISH",
      skipReview: false,
      blockOnWarnings: true,
    }),
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [slug, action] = process.argv.slice(2);
    const config = extensions[slug];
    if (!config) throw new Error("Choose vblur or intentional.");
    const manifest = JSON.parse(
      await readFile(join(repoRoot, config.root, "manifest.json"), "utf8"),
    );
    const result = await deploy({
      action,
      publisherId: process.env.CHROME_WEBSTORE_PUBLISHER_ID,
      extensionId:
        slug === "vblur"
          ? process.env.CHROME_EXTENSION_VBLUR_ID
          : process.env.CHROME_EXTENSION_INTENTIONAL_ID,
      accessToken: process.env.CHROME_WEBSTORE_ACCESS_TOKEN,
      version: manifest.version,
      packageBytes:
        action === "status"
          ? undefined
          : await readFile(
              join(repoRoot, "dist", `${slug}-${manifest.version}.zip`),
            ),
    });
    // Print only release status, never authentication responses or keys.
    console.log(
      JSON.stringify(
        {
          extension: slug,
          action,
          version: manifest.version,
          uploadState: result.uploadState || result.lastAsyncUploadState,
          state: result.state,
          published: result.publishedItemRevisionStatus,
          submitted: result.submittedItemRevisionStatus,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
