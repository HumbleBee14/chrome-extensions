# Intentional

A local-first Chrome extension for using websites on purpose. Set daily limits for a whole website, an individual path, or a path and its children. Choose a reason and a timed intention session, with reminders before it ends.

## Install locally

1. Open `chrome://extensions` in Chrome 120 or newer.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this repository’s **`intentional/extension`** folder.
4. Pin **Intentional** to the toolbar and open **Settings**.
5. Add a limit and approve Chrome’s access request for that website.

**Leave** opens Chrome’s New Tab page, with `about:blank` as a fallback if the extension connection is lost. If an existing tab loses its extension connection, it shows **Reload page** and **Leave this page**.

No build, account, or server is needed. After changing extension files, reload the extension in Chrome and refresh open website tabs.

## Choose the right boundary

| Target               | Monitor         | What it covers                                         |
| -------------------- | --------------- | ------------------------------------------------------ |
| `reddit.com`         | Whole website   | Every Reddit path                                      |
| `reddit.com/r/books` | Path + children | That community and its posts, excluding `/r/bookstore` |
| `youtube.com/shorts` | Path + children | Shorts and individual Shorts videos                    |
| `example.com/read`   | Exact path      | `/read` and `/read/`, excluding `/read/chapter`        |

**Include subdomains** includes `www`, `m`, `old`, and other subdomains. Turn it off to monitor only the hostname you enter. Paths are case-sensitive. HTTP and HTTPS share the same allowance. Queries and fragments do not affect matching and are not included in intention logs. Targets must not contain login credentials, ports, queries, fragments, or wildcards. IDN hostnames are normalized by the URL parser.

When a whole-site limit and a more specific path limit overlap, **both apply**. A minute in a subreddit counts against both its own rule and any matching Reddit-wide rule. An exhausted matching rule blocks the page.

## Activity

Choose **Day** or **Week** and a date. Metrics follow that period: active foreground time, retained session reasons, per-limit override approvals, and active time over limit. Click a weekly day to inspect its reasons. Overlapping limits count once in the time totals. Active-time totals start with this update; older periods show an unavailable or partial total. Export and Clear logs apply to the selected period; clearing reasons preserves usage and override totals. History stays local and is pruned after 30 days, with a maximum of 1,000 detailed reasons and a 2 MiB reason-history budget.

## Daily limits and session timers

- **Daily allowance:** counts only the active tab in the focused Chrome window. Reading and watching still count without keyboard activity. Switching tabs, switching apps, screen locking, or waiting at the intention gate pauses daily usage. Multiple windows and tabs do not multiply time.
- **Intention session:** choose a reason and duration before entering. The default is 15 minutes, capped by the smallest remaining daily allowance across matching rules. Only whole-minute inputs are accepted. When less than a minute remains, use the remaining seconds with one explicit action. Longer durations are rejected. The timer measures elapsed time even when you switch tabs, leave the path, close a tab, or restart Chrome. All matching tabs and child pages share approval; refreshes and return visits do not restart the timer or ask again.
- **Session check-in:** when the session ends, the page pauses and prefills your last reason in the editable field. Keep it or change it, then choose a duration within your remaining daily allowance. With less than a minute left, the same form offers Use remaining seconds without retyping the reason. Session expiry does not create a network block.
- **Daily boundary:** reaching the daily allowance always opens the daily-limit screen first, with Leave as the primary action and a midnight-reset reminder. If overrides are allowed, Choose extra time opens a separate reason-and-duration form. Back returns to the limit screen. Every expired override returns to the limit screen before another continuation. Choose extra time on each check-in, capped by that rule’s daily limit (and any tighter overlapping allowance). When it expires, another reason and duration are required. Refreshes and child pages share the existing override deadline.
- **Prevent overrides:** this checkbox is off by default. Enable it to close the rule until midnight after the daily allowance is used. Matching network navigations then redirect to the compact limit screen. If overlapping rules disagree, a reached rule with overrides prevented takes precedence.
- **Warnings:** a small countdown stays visible on allowed monitored pages. One dismissible live warning appears during the final 30 seconds and stays until dismissed or time runs out. Once dismissed, it does not reappear for that timer or daily allowance. Warnings apply to daily and session time. Dismissals are shared across refreshes, child pages, and tabs for that timer or daily allowance; a renewed timer gets fresh reminders.
- **Reset:** daily allowances and intention sessions reset at local midnight. Usage history is retained separately.

Foreground pages report every five seconds, supported by Chrome alarms and tab, window, idle, and navigation events. The on-page clock requests a check when its countdown reaches zero. Chrome can delay background work, especially during sleep; daily accounting bounds unobserved intervals to ten seconds instead of charging a long sleep. This is practical attention tracking rather than second-perfect telemetry.

## Intention prompts and activity logs

New rules enable **Intentional visits** by default: enter a reason and choose a duration together. Turn it off for daily limits alone. Existing rules retain legacy reason/timer settings until edited. Info buttons explain Intentional visits and Prevent overrides on hover, focus, or click. The compact prompt shows **Reason**, **Time**, and the remaining **Max … min** beside the time input. Use the optional **Message note** for custom text, in bold, with a brighter six-color picker that defaults to black. Notes are capped at 160 characters, with a live counter.

**Common reasons:** manage one list in Settings, with up to five entries and 16 characters per new or edited choice. New profiles include editable examples such as **Quick Check**. Existing common lists, including empty ones and unchanged older choices up to 30 characters, remain intact across updates. The prompt has one free-text reason field: matching prefix suggestions appear only after typing. Click a hint or focus it with Tab and press Enter to fill the field; Escape dismisses suggestions. Accepting a hint never submits the form. Old per-website lists remain stored but no longer control suggestions.

Approval belongs to the monitored rule until its session deadline. Reloads, child pages, new tabs, and leaving/re-entering share it. Entering a different rule without an active session asks for a new intention. Chrome’s history navigation events also cover websites such as YouTube and Reddit that change paths without reloading.

The **Activity log** groups visits by local date. Override entries have their own highlight, reason, duration, and attempt number per rule and local day. The over-limit summary tracks actual foreground time beyond the daily allowance separately from normal usage. Attempt counts increase only when a continuation is approved, not when a warning appears. Clearing logs preserves counts and over-limit totals; deleting a rule removes its counters. Full exports include these records. Each record includes the time, matching rule names, reason, and session duration when a new timer was selected. You can filter by date, export the selected logs, clear a single day, or clear the selected week. **Clearing logs never resets daily usage, override counts, over-limit totals, or an active timer.** Logs and usage history are retained for 30 days; logs are also capped at 1,000 records and 2 MiB, removing the oldest first.

**Settings** includes a full JSON export and **Erase all data**, which removes limits, usage, intentions, timers, and network blocks. Exported files must be deleted separately. Website permissions remain granted until you revoke them in Chrome or uninstall the extension.

## Optional extension-page guard

The guard is **OFF by default**. Enable it in Settings to redirect `chrome://extensions` and its subpages to an intention reminder. Chrome requests the optional `tabs` permission so the extension can recognize those internal URLs. The reminder has a direct **Turn off guard and open Extensions** action. The guard can also be turned off from Intentional Settings; revoking its tab permission also turns it off.

This adds friction, **not uninstall protection**. Chrome Web Store reviewers determine whether the disclosed optional behavior is acceptable; no approval is implied. It cannot prevent toolbar removal, disabling through other interfaces, using another profile/browser, or disabling the extension before a redirect occurs. Administrator-managed force installation can prevent disabling and removal, but that requires configuration outside an ordinary extension. No browser policies or operating-system settings are modified here. [Chrome’s managed installation documentation](https://support.google.com/chrome/a/answer/7649924)

## Privacy and Chrome requirements

All data lives in this Chrome profile. No analytics, remote services, remote scripts, cloud sync, or runtime dependencies. Website access is requested only when saving a rule. Chrome grants access at the hostname level, even when a rule monitors one path. Only monitored rules are counted; page content and unmonitored browsing histories are not stored.

The implementation uses Manifest V3, an event-driven module service worker, persisted local/session storage, optional host permissions, registered isolated content scripts, and declarative network redirects. All code is packaged locally. Extension storage is restricted to trusted extension contexts; content scripts communicate through validated messages. The [bundled privacy policy](extension/ui/privacy.html) describes collection, retention, controls, and Limited Use.

Reviewed against official documentation on November 9, 2026:

- [Manifest V3 code requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- [Service-worker lifecycle and persistence](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Declarative Net Request and host access](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [Optional permissions and user gestures](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Dynamic content-script registration](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Alarms and scheduling limits](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [Chrome Web Store user-data requirements](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

Chrome Web Store approval has not been obtained. Before submission, publish the privacy policy at a public URL, complete permission and data-use disclosures, prepare listing assets, and run the manual acceptance checks in [docs/verification.md](docs/verification.md).

## Development

```sh
cd intentional
npm ci
npx playwright install chromium
npm run check
npm run test:browser
npm run test:reconnect
npm run test:form
npm run test:activity
npm run test:ui
npm run package
```

`npm run format` formats the source; `npm run format:check` checks it. Runtime code is plain modular JavaScript and CSS. Use Node.js 24 or newer for development. `npm run package` writes `dist/intentional-1.0.0.zip` containing only the extension files.

The browser suite runs in a disposable Chromium profile with the actual source. Its temporary manifest pregrants **localhost access and tabs** because native permission dialogs are not automatable in headless mode. It never changes the shipped manifest or your Chrome profile. Test screenshots and machine-readable results are written under `artifacts/`.

```text
extension/
  background/   Chrome events, storage, tracking, and enforcement
  core/         URL matching, daily accounting, intentions, and locks
  content/      Page gate, countdown, warnings, and media pause
  ui/           Toolbar popup, limits, activity, settings, and lock pages
  icons/        Local extension icons
scripts/        Manifest validation and packaging
tests/          Core/tracker tests and Chromium integration checks
docs/           Architecture and verification notes
```

## Boundaries

- Chrome desktop, HTTP/HTTPS main-frame pages only. No incognito support, local files, browser-internal website monitoring, or embedded frame monitoring.
- Chrome-protected sites such as the Web Store may reject content-script injection. They should not be used as monitoring targets.
- Intention gates block interaction after the page begins loading. They do not prevent the initial network request. Exhausted-limit redirects operate on network navigation; content scripts also guard SPA routes and already-open pages.
- Settings remain editable. Intentional is a voluntary focus tool, not a parental-control or tamper-proof security product.
- Changing the system clock/timezone can affect resets and elapsed deadlines.
- Core tests and local Chromium fixtures are automated evidence. Actual YouTube/Reddit media behavior, operating-system sleep/lock transitions, and Chrome’s native permission approval/denial still require manual checks.

## License

[MIT](LICENSE). See [release readiness](docs/release-readiness.md) for the audit findings, store disclosures, and final manual checks.
