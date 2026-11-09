export const MAX_MESSAGE_LENGTH = 160;
export const MAX_REASON_LENGTH = 16;
export const MAX_REASON_COUNT = 10;
export const DEFAULT_REASONS = [
  "Quick Check",
  "Research",
  "Learning",
  "Work",
  "Casual Browsing",
];
export const MESSAGE_COLORS = [
  { value: "#27372f", name: "Black" },
  { value: "#00875a", name: "Green" },
  { value: "#0969ff", name: "Blue" },
  { value: "#8b2cf5", name: "Purple" },
  { value: "#c65100", name: "Orange" },
  { value: "#e5252a", name: "Red" },
];
const previousColors = {
  "#244c3d": "#00875a",
  "#2456a6": "#0969ff",
  "#7042a0": "#8b2cf5",
  "#875318": "#c65100",
  "#a13d36": "#e5252a",
};
export function normalizeMessage(value) {
  return String(value || "")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

export function normalizePresets(input = [], previous = []) {
  if (!Array.isArray(input)) throw new Error("Enter a list of saved reasons.");
  const seen = new Set();
  const values = [];
  for (const item of input) {
    if (typeof item !== "string")
      throw new Error("Each saved reason must be text.");
    const value = item.trim();
    if (!value) continue;
    const length = [...value].length;
    const unchangedLegacy =
      length <= 30 &&
      previous.some(
        (item) => typeof item === "string" && item.trim() === value,
      );
    if (length > MAX_REASON_LENGTH && !unchangedLegacy)
      throw new Error(
        `Saved reasons can contain at most ${MAX_REASON_LENGTH} characters.`,
      );
    if (value.length < 3)
      throw new Error("Use at least 3 characters for a saved reason.");
    const key = value.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      values.push(value);
    }
  }
  if (values.length > MAX_REASON_COUNT)
    throw new Error(`You can save up to ${MAX_REASON_COUNT} reasons.`);
  return values;
}

export function presetsFor(state) {
  return state.settings?.reasonPresets || [];
}

export function messageColor(value) {
  value = previousColors[value] || value;
  return MESSAGE_COLORS.some((color) => color.value === value)
    ? value
    : MESSAGE_COLORS[0].value;
}
