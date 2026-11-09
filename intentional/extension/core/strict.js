export function shouldGuard(settings, address) {
  if (!settings?.strictMode) return false;
  try {
    const url = new URL(address);
    return (
      url.protocol === "chrome:" &&
      (url.hostname === "extensions" ||
        (url.hostname === "settings" &&
          /^\/extensions(?:\/|$)/.test(url.pathname)))
    );
  } catch {
    return false;
  }
}
