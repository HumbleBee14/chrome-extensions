export class RequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RequestError";
    this.code = code;
  }
}

export function isSettingsSender(sender, extensionId, baseUrl) {
  if (
    sender.frameId > 0 ||
    sender.id !== extensionId ||
    !sender.url?.startsWith(baseUrl)
  )
    return false;
  const path = new URL(sender.url).pathname;
  return [
    "/ui/options.html",
    "/ui/popup.html",
    "/ui/blocked.html",
    "/ui/strict.html",
  ].includes(path);
}
