# Chrome Web Store releases

The **Chrome Web Store** GitHub Actions workflow builds separate ZIPs for VBlur and Intentional. Pushes and pull requests run checks and build artifacts. Store operations run manually from `main` for one selected extension.

## Connect a developer account

In GitHub → Settings → Secrets and variables → Actions, configure:

| Type     | Name                              | Value                                       |
| -------- | --------------------------------- | ------------------------------------------- |
| Secret   | `CI_GOOGLE_CLIENT_ID`             | OAuth client ID                             |
| Secret   | `CI_GOOGLE_CLIENT_SECRET`         | OAuth client secret                         |
| Secret   | `CI_GOOGLE_REFRESH_TOKEN`         | Refresh token authorized by the store owner |
| Secret   | `CHROME_EXTENSION_VBLUR_ID`       | Existing VBlur store item ID                |
| Variable | `CHROME_WEBSTORE_PUBLISHER_ID`    | Publisher → Settings → Publisher ID         |
| Variable | `CHROME_EXTENSION_INTENTIONAL_ID` | Intentional store item ID                   |

Both items can share OAuth credentials when the authorized Google account can manage both. Enable the Chrome Web Store API in the OAuth client’s Google Cloud project. The required scope is `https://www.googleapis.com/auth/chromewebstore`.

If credentials need replacing, follow Google’s [API setup guide](https://developer.chrome.com/docs/webstore/using-api): use your own OAuth client in OAuth Playground, authorize the scope as the store owner, and exchange the code for a refresh token. Store credentials directly as GitHub secrets.

## Create Intentional’s store item once

1. Build with `node scripts/package-extension.mjs intentional` or download the `intentional` artifact from a successful workflow run.
2. In the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), choose **New item** and upload `dist/intentional-1.0.0.zip` (use the current version’s filename).
3. Copy the new item’s 32-character extension ID into `CHROME_EXTENSION_INTENTIONAL_ID`.
4. Complete the listing, screenshots, privacy disclosures, distribution settings, and any account verification requirements before submitting. Review [Intentional’s release readiness](../intentional/docs/release-readiness.md), including its open storage-policy question.

Creating a draft does not submit it for review or make it public.

## Release an update

Increase `version` in the selected extension’s manifest, commit the change, and let its checks pass. VBlur’s manifest is `vblur/manifest.json`; Intentional’s is `intentional/extension/manifest.json`.

Open GitHub → Actions → **Chrome Web Store** → **Run workflow**, select `main`, the extension, and an action:

| Action   | Result                                                                     |
| -------- | -------------------------------------------------------------------------- |
| `build`  | Checks and downloadable ZIP only                                           |
| `status` | Reads the selected item’s current store status; verifies API credentials   |
| `upload` | Uploads a new draft package without submitting it                          |
| `submit` | Uploads the package and submits it for review; it goes live after approval |

The API preserves the item’s existing visibility. Changing visibility may require a manual publication in the dashboard first. Async uploads are polled before submission; failed or unfinished uploads stop the workflow. Duplicate published versions are rejected. API warnings block submission for inspection in the dashboard.

Official references: [API setup](https://developer.chrome.com/docs/webstore/using-api), [upload](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload), [submission](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish).
