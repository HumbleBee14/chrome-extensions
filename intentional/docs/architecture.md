# Architecture

The service worker owns all persistent state and serializes events and messages through one promise queue. Content scripts cannot read extension storage or change limits. UI pages send validated management messages from this extension’s origin; content scripts send only visit, heartbeat, approval, and leave requests from the main frame.

## Data

`chrome.storage.local.state` contains rules, daily counters keyed by local date and rule ID, session deadlines and reasons, override deadlines and reasons, per-day override counts and foreground over-limit totals, legacy lock records, intention logs, and settings. `chrome.storage.session.runtime` holds the tracking cursor, reminder dismissals, and rules missing website permission. A worker restart rehydrates these records rather than relying on global variables. Session deadlines and network rules survive a browser restart.

Daily counters are settled from the previously observed focused tab before a new tab is selected. Each matching rule is charged once per interval. Intervals are split at local midnight, capped to ten seconds across unobserved gaps, and limited to the daily allowance. No usage accrues while a reason or timer prompt awaits approval.

Intention approval belongs to a shared per-rule session. Refreshes, child pages, new tabs, re-entry, and browser restarts retain it until the deadline. New sessions default to 15 minutes capped by the smallest matching daily remainder. The worker validates durations against all matching daily allowances before changing any session. Expiry retains the original reason for reflection and requires explicit renewal; it creates no daily lock. Old session locks are cleared during reconciliation. Daily exhaustion pauses access; a separately approved override can resume it unless any exhausted matching rule prevents overrides. Overrides persist across documents and restarts, expire after the duration chosen at each check-in, capped by the daily limit and any tighter overlapping allowance, and stop at midnight. They never increase the ordinary daily allowance.

## Enforcement

Saving a rule requests optional host access, checks Chrome’s regex support, and registers one persistent isolated content script for the granted hosts. It also injects that script into eligible open tabs. A per-document sentinel prevents duplicate UI and heartbeat loops.

The content script uses a closed shadow root for style isolation and a native modal dialog for interaction and keyboard containment. Reasons and all user-controlled labels are written with `textContent`. No page-facing message bridge exists. Media playback is paused while a gate or lock is open; continuation does not force playback to resume.

Exhausted rules with `preventOverrides` enabled produce persistent Declarative Net Request redirects for main-frame navigations. URL regexes anchor the hostname and path boundaries, preserve path case, and explicitly include subdomains only when selected. Every matching rule is also evaluated in the content script flow, so a broad daily allowance cannot override a narrower lock. SPA history events and an on-page URL check cover navigation that does not send a main-frame network request.

Recurring alarms provide reconciliation, and a boundary alarm targets the earliest future session deadline, current active daily deadline, or local midnight. Alarms can be late; foreground heartbeat/countdown checks provide finer-grained enforcement. Dynamic rules are updated only when the desired rule set changes.

The content script uses one 30-second warning window for daily, session, and override clocks. A dismissed warning stays closed through expiry, with no later warning stage. Dismissal is stored in session storage against the rule and exact timer deadline or local-day allowance, so it survives heartbeat updates, reloads, child documents, and other tabs. The worker validates the rule, 30-second window, and exact warning key; a stale document may finish dismissing that same warning during navigation, but cannot approve access or silence a renewed timer. Timer text updates without rebuilding the popup or moving keyboard focus.

## Optional guard

The extension-page guard is a separate setting, disabled by default. It requests optional `tabs` access, recognizes extension-manager URLs, and redirects them to an extension reminder. The setting turns off if that permission is revoked. This is a friction feature: Chrome retains independent uninstall and disabling controls. No management permission or machine policy is requested or configured.

## Prompt preferences

One common reason list in Settings supplies typing hints everywhere. Lists allow five unique trimmed reasons, each 3–16 characters for new or edited choices. Unchanged legacy choices up to 30 characters are preserved. New-profile defaults are created only when state is absent; updates never overwrite existing lists or seed an empty list. Legacy per-rule lists remain stored without controlling suggestions. The content script displays matching case-insensitive prefix hints only for non-empty text, omits exact matches, and supports keyboard or pointer acceptance without submission. Escape dismisses hints, and unmatched free text remains unrestricted by the preset length cap. Message colors are restricted to six saturated readable local palette values and default to the normal dark text color. Earlier palette choices migrate by hue, and custom notes render in bold. Notes are capped at 160 characters on input and storage loading. Rule changes update an open gate when its note, color, or reason list changes.

The single Intentional visits control writes the existing reason and session flags together. Legacy timer-only rules remain valid until edited. Time fields show a live remaining daily maximum and retain worker-side duration validation. Popup actions deep-link to the existing rule editor or an Add form; navigation uses separate Limits, Activity, and Settings screens.

## Override accounting

Each approved continuation creates an `override` log entry with per-rule attempt numbers and interval lengths. Attempts are counted per rule and local day in `overrideCounts`, independently of deletable log entries. `overtimeDays` records bounded foreground time within active override deadlines, while ordinary daily totals remain capped. One continuation can cover several exhausted rules; their counters remain independent and the chosen duration respects the tightest matching allowance. The retired per-rule override interval is ignored; each approval chooses whole minutes capped by the daily limit. `core/timing.js` shares validation and maximum calculations between status and approval. Sub-minute remainders use an explicit remaining-time action and logs retain the exact duration in milliseconds. A prevented overlapping rule rejects the entire continuation before any counter changes.

## Retention and deletion

Records older than 30 days are removed during reconciliation. Intention logs are additionally capped at 1,000 records and 2 MiB of UTF-8 JSON. Retention uses the same 30 local calendar dates as the Activity picker. Clearing a date or all logs does not touch daily counters, override attempt counts, over-limit usage totals, deadlines, or locks. Override counts and over-limit totals are also pruned after 30 days. Deleting a rule removes its counters and lock but preserves past intention labels. Erasing all data clears rules and dynamic redirects, disables the optional guard, and notifies existing pages so their gate UI is removed.

## Activity periods

The Activity screen defaults to the current local day and supports Monday–Sunday weeks. All headline metrics, reason lists, exports, and period clearing use the selected local dates. Session counts derive from retained reason entries, while per-rule override counters survive log deletion. The interface states the 1,000-entry ceiling.

`activeDays` and `activeOvertimeDays` store one foreground duration per local day. Reconciliation updates these alongside existing per-rule accounting, counting overlapping limits once and splitting at midnight. `activitySince` marks when these aggregates became available; upgrades preserve existing logs and counters and label older time totals unavailable or partial. Aggregate records use the same 30-day pruning as existing usage. Clear logs preserves aggregates; erase all data resets them.

Reason editors use Enter to validate the current list and add a focused empty draft, up to five choices. Common reasons persist immediately on Enter; per-limit drafts remain inside the limit form until Save. Blank drafts are excluded when saving. Enter never submits the surrounding limit form.

Accounting determines the earliest boundary across all active matching limits before charging any rule. Per-rule daily usage, combined active time, and overtime use the same bounded interval. This avoids charging other overlapping rules while a session-expiry or daily-limit prompt is waiting.

## Popup summary

The popup refreshes its lightweight dashboard summary once per second while open, with overlapping requests suppressed. Each matching rule shows actual foreground time used today (daily usage plus overtime) and its daily limit in explicit units. A single countdown below the totals uses the earliest applicable session or daily boundary across enabled, granted rules. Extra time, waiting for an intention, expiry, paused rules, and missing access have explicit labels. Used time rounds down to whole seconds; remaining time rounds up. A website is not repeated as both the page title and a rule title unless multiple rules need distinct scope labels.

The Limits dashboard refreshes immediately on visibility/focus and polls the same background summary once per second while visible. Only budget/status elements are replaced during these updates, leaving Edit buttons and focus intact. Activity/settings retain a slower full refresh. Dashboard and popup share used-duration rounding and total-used calculations; neither keeps a separate usage counter. The background settles the current tracking cursor into the daily counters when a tab closes.
