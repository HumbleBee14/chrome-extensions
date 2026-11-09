# Intentional privacy policy

Effective November 9, 2026.

Intentional helps you manage time on websites and paths you choose. It has no account, server, analytics, advertising, cloud sync, or remotely loaded code. Extension data stays in your Chrome profile. The developer does not receive it or share it with third parties.

## Data and purpose

Intentional stores your selected domains and paths, limits, message notes, saved reason choices, and settings. It checks the active tab's address to determine whether your limits apply. It records foreground usage, intention reasons you enter, timestamps, matching rule names, chosen session durations, override numbers, and time spent over limits. These records provide the prompts, time limits, and Day/Week Activity views you choose to use.

Temporary tab identifiers and warning dismissals support tracking and reminders. Session and override deadlines persist across browser restarts and reset at local midnight. Page content and the browsing history of unmonitored sites are not stored. URL queries and fragments are not included in activity logs. Avoid entering passwords or other secrets in reason fields.

## Retention and storage

Usage and activity history cover the most recent 30 local calendar days. Detailed reason logs are also capped at 1,000 entries and 2 MiB; the oldest entries are removed first when either ceiling is reached. Cleanup runs when the extension processes activity or reconciles its state. Rules and settings remain until changed or deleted.

Storage uses Chrome's local and session extension storage. It is restricted to trusted extension contexts; the extension does not add its own encryption layer. Chrome profile and device security determine protection against local access.

## Permissions and optional features

Chrome requests website access when you save a limit. Access is granted per host even when you monitor one path. Intentional uses it to display intention prompts, show timers, pause media while a prompt is open, and redirect exhausted limits when you enable Prevent overrides.

The extension uses the current tab, window focus, screen-lock state, and navigation events to track foreground time and apply rules as you navigate. It does not request access to browser history, cookies, passwords, or payment information.

The optional extension-page guard is off by default. If enabled, it requests `tabs` access to recognize Chrome's Extensions page and show a reminder. Addresses are checked in memory and are not logged. The reminder includes a direct action to turn off the guard and open Chrome's Extensions page. It cannot prevent disabling or uninstalling the extension. Incognito is disabled for this extension.

## Your controls

You can edit or delete limits, revoke website permissions in Chrome, export records to a local JSON file, or clear reasons for a day or week. Clearing reasons preserves usage totals, override counts, and active limits. Erase all data removes all extension rules, usage, reasons, counters, timers, and settings. Chrome website permissions remain until you revoke them or uninstall. Uninstalling removes the extension's stored data. You must delete exported files separately.

## Limited Use

Information accessed through Chrome APIs is used only to provide the disclosed website and path time-limit features. It is never sold, transmitted to third parties, used for advertising, or used for unrelated purposes. This use adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

For support or privacy questions, use the developer support contact on Intentional's Chrome Web Store listing. Do not include private activity exports in public support reports.
