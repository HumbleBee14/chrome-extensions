# Release audit — November 9, 2026

The source is prepared for final manual acceptance testing. This is a local code and policy review, not Chrome Web Store approval. Nothing has been published, pushed, or submitted.

## Fixes from the audit

- Accounting now computes the first boundary across all matching rules before charging any rule. Late heartbeats cannot charge an expired session, its overlapping limits, or the new day while a fresh intention is required.
- Detailed logs have a 2 MiB UTF-8 JSON ceiling in addition to 1,000 entries. Usage and reasons use the same 30 local calendar days as the date picker. This keeps worst-case overlapping-rule logs below Chrome's local-storage quota without requesting unlimited storage.
- The manifest explicitly disables incognito, matching the advertised behavior. Extension pages cannot be embedded in another page, and management messages from subframes are rejected.
- Add Limit discloses local usage/reason storage before saving. Privacy copy includes combined activity totals, retention limits, deletion controls, and the optional guard.
- The optional guard reminder offers a direct action to disable the guard and open Chrome's Extensions manager. The feature remains opt-in and is not uninstall protection.
- Hidden tabs no longer send a periodic five-second heartbeat. Losing site permission clears a previously injected gate without granting an intention.
- A stale intention approval is treated as an expected navigation race rather than a console error.
- ZIP naming uses the manifest version; manifest checks require the npm and manifest versions to agree.
- Development dependencies are refreshed. ESLint's vulnerable transitive minimatch version is overridden to the patched 11.x line; remove the override once ESLint's own supported range includes the fix. Development dependencies are not in the extension ZIP.
- MIT licensing is included. No runtime dependencies, analytics, remote code, credential files, or developer endpoints were found in the extension source.

## Follow-up fixes

- Visit and override durations share whole-minute validation and bounded maximum calculations. Each override now asks for a duration capped by its daily limit and tighter overlapping allowances; the former fixed override interval is unused.
- Sub-minute allowances use an explicit remaining-seconds action. Activity retains exact durations, and usage displays minutes and seconds instead of fractional or rounded-up minutes.
- Open pages receive saved target/time changes immediately; the popup refreshes on rule-change notifications. Saving a rule clears its legacy lock and previous approvals.
- The 30-second warning contains only the countdown and a short wrap-up message.
- Invalid duration requests return a structured validation error without polluting Chrome's extension error list. Unexpected failures still log errors.
- Open-tab injection is limited to enabled, granted rule hosts, including other paths on those hosts so SPA navigation remains covered. Unrelated, denied, and disabled hosts receive no injection attempt.

## Unresolved store-policy requirement

The current [User Data FAQ, question 9](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) says stored user data must use strong encryption. This extension uses `chrome.storage.local` with trusted-context access restrictions, but does not add at-rest encryption. Chrome profile/device protection is not evidence that the extension satisfies that statement. Do not mark the submission fully policy-ready until this is resolved: either implement and verify an appropriate encryption/key-management design, or obtain authoritative clarification covering these local-only records. Storing a decryption key alongside the data should not be presented as meaningful protection against local-profile access.

On November 9, the user chose to keep automatic startup and verify policy before changing storage. A fresh check found that the [main handling requirements](https://developer.chrome.com/docs/webstore/program-policies/data-handling) require secure handling and encrypted transmission, while FAQ question 9 explicitly adds encryption at rest. No official local-only exemption was found. The main policy's broader wording is not evidence that the FAQ can be ignored.

A passphrase-unlock design would change startup and background enforcement behavior, so it has not been introduced. The public and bundled policies disclose the current storage behavior honestly.

## Verification completed

- `npm run check`: lint, 70 unit tests, and manifest validation passed.
- `npm run format:check`: passed.
- Browser, form, Activity, UI workflow, and reconnect/version-update suites passed in disposable Chromium profiles.
- The actual packaged ZIP was extracted and loaded with its unmodified manifest: Limits, Activity, Settings, optional host permissions, and incognito exclusion passed smoke checks.
- `npm audit`: zero reported vulnerabilities, including development dependencies.
- ZIP inspection confirmed only extension files and the MIT license; no tests, development dependencies, personal exports, or credentials are included.
- `git diff --check`: passed. No commit, push, or publication was performed.

## Store preparation

Before submission:

1. Publish [privacy.md](privacy.md) at a public, readable HTTPS URL and enter it in the Developer Dashboard. A bundled policy alone does not satisfy the public-link requirement. Keep it synchronized with the in-extension policy.
2. Complete the single-purpose, permission, and data-use disclosures below. Local-only processing still requires disclosure; do not claim that the extension handles no user data.
3. Add an accurate description, a 128×128 PNG icon, and at least one current screenshot. Google recommends 16px transparent padding around the 96px artwork in the store icon. Automated fixture screenshots are test evidence; create clean representative listing screenshots without personal reasons or browsing data.
4. Confirm developer contact/support details and account 2-Step Verification.
5. Complete the manual acceptance list below, then upload the ZIP created by `npm run package`.

### Single-purpose draft

Help users browse intentionally by applying user-selected website and path time limits, requesting a reason and session duration, and showing local activity history for reflection.

### Permission justifications

| Permission                            | Current use                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                             | Persist user-selected limits, reasons, bounded activity history, and timers locally; retain temporary tracking state in session storage. |
| `alarms`                              | Reconcile timers and daily resets when extension pages are closed.                                                                       |
| `scripting`                           | Register and inject locally packaged prompts/timers only on granted websites.                                                            |
| `activeTab`                           | Read the current site's address when the user opens the toolbar popup, so Add/Edit limit targets that site.                              |
| `idle`                                | Pause foreground accounting while the screen is locked.                                                                                  |
| `webNavigation`                       | Detect path changes on single-page applications and validate messages against the current top-level document.                            |
| `declarativeNetRequestWithHostAccess` | Redirect exhausted limits only on granted websites when the user enables Prevent overrides.                                              |
| Optional HTTP/HTTPS host access       | Users can choose any supported website. Access is requested for that rule's host when saved, not for all sites at installation.          |
| Optional `tabs`                       | Only the opt-in extension-page guard needs broader tab-address access to recognize Chrome's Extensions manager.                          |

### Data disclosures

Describe the actual local handling of selected domains/paths, foreground browsing activity, usage totals, user-entered reasons/notes, session choices, and override activity. No data is sent to the developer or other parties. No ads, sales of data, analytics, cookies, browsing-history API, payment information, or remote code are used. The exported JSON is a local file deliberately requested by the user. Match dashboard category definitions to this behavior; the privacy policy and listing must tell the same story.

The optional guard is the highest review-sensitivity feature: it intercepts an internal browser management page. Its opt-in state, clear description, and direct disable action improve reversibility. The reviewed policies do not specifically approve this implementation. Do not claim guaranteed approval; disclose it explicitly in reviewer notes. If review objects to the feature, remove it and the optional `tabs` permission rather than concealing its behavior.

## Final manual acceptance

- Install the shipped folder in ordinary Chrome using its unmodified manifest. Deny, then approve website access. Verify a denied permission leaves a useful message and can be retried.
- Test Reddit and YouTube SPA navigation, www/bare-domain input, subdomains on/off, exact versus child paths, and two overlapping limits.
- Choose a short session; refresh, switch tabs/apps, restart Chrome, and return. Confirm one 30-second reminder, no timer restart, correct expiry, and no billing while the prompt is waiting.
- Cross a daily limit, approve two overrides, and check numbered reasons and actual overtime. Verify Prevent overrides and the next local-midnight reset.
- Confirm Day/Week totals, date selection, exports, reason clearing, and Erase all data. Old pre-update active-time totals must remain unavailable or explicitly partial.
- Enable the optional guard, then use its direct disable/open action. Confirm Chrome's normal uninstall and permission controls remain reachable.
- Reload the extension while a monitored page is open. Verify the reconnect screen's Reload and Leave actions.
- Confirm layout and keyboard navigation at normal browser zoom. Native media, OS sleep/lock, Chrome's permission dialogs, and real-site behavior need these manual checks.

## Sources checked

- [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies): single purpose, minimum permissions, truthful disclosures, user control, privacy, listing assets, and account requirements.
- [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq): local-only handling still requires disclosure and a privacy policy.
- [Manifest V3 code requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements): packaged, reviewable functionality; no remotely hosted executable code.
- [Incognito manifest behavior](https://developer.chrome.com/docs/extensions/reference/manifest/incognito): explicit `not_allowed` support.
- [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage): storage access levels and local quota.
- [Store images](https://developer.chrome.com/docs/webstore/images): icon and screenshot requirements.
- [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249): patched version 11.0.1 or newer.

## Policy clarification draft (not sent)

Intentional is a local-only Manifest V3 extension that stores user-selected website/path limits, bounded foreground usage, and user-entered reasons in `chrome.storage.local`, with access restricted to trusted extension contexts. It has no server, analytics, cloud sync, or transmission of these records. Automatic enforcement resumes after Chrome restarts. Does FAQ question 9 require application-level at-rest encryption for these local Chrome-profile records? If so, what supported key-management approach satisfies this requirement while preserving automatic startup? We do not claim that storing an encryption key alongside the data protects against profile access.

Obtain authoritative clarification before treating this item as resolved. The draft has not been submitted and no approval has been received.
