# Chrome Web Store releases

The **Chrome Web Store** GitHub Actions workflow builds separate ZIPs for VBlur and Intentional. Pushes and pull requests run checks and build artifacts. Store operations run manually from `main` for one selected extension.

## Connect a developer account

The workflow uses Google Workload Identity Federation to obtain short-lived access tokens for **Chrome Extensions Publisher**. It requires no OAuth refresh token or downloaded service-account key.

Configure these GitHub Actions settings:

| Type     | Name                              | Value                                             |
| -------- | --------------------------------- | ------------------------------------------------- |
| Secret   | `CHROME_EXTENSION_VBLUR_ID`       | Published VBlur store item ID                     |
| Variable | `CHROME_EXTENSION_INTENTIONAL_ID` | Intentional store item ID                         |
| Variable | `CHROME_WEBSTORE_PUBLISHER_ID`    | Publisher → Settings → Publisher ID               |
| Variable | `CHROME_GOOGLE_SERVICE_ACCOUNT`   | Chrome Extensions Publisher service-account email |
| Variable | `CHROME_GOOGLE_IDENTITY_PROVIDER` | Full workload identity provider resource name     |

In Google Cloud, enable the Chrome Web Store API and create a service account without project roles. Link its email in the Chrome Web Store Developer Dashboard’s publisher Settings → Service account.

Create a workload identity pool and GitHub OIDC provider with issuer `https://token.actions.githubusercontent.com`. Map `google.subject=assertion.sub` and `attribute.repository_id=assertion.repository_id`. Restrict the provider condition to this repository’s numeric ID, owner’s numeric ID, `refs/heads/main`, and this workflow’s `workflow_ref`.

Grant `roles/iam.workloadIdentityUser` on the publisher service account to the pool’s repository principal set. The workflow requests only the `https://www.googleapis.com/auth/chromewebstore` scope, and only its manually dispatched store job receives GitHub `id-token: write` permission.

Official setup: [Chrome Web Store service accounts](https://developer.chrome.com/docs/webstore/service-accounts), [Google GitHub authentication action](https://github.com/google-github-actions/auth), and [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines).

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
