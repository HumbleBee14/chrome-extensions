import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "dist/**", "artifacts/**"] },
  js.configs.recommended,
  {
    files: ["extension/**/*.js"],
    languageOptions: { globals: { ...globals.browser, chrome: "readonly" } },
  },
  {
    files: ["tests/**/*.js", "scripts/**/*.js", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      "tests/browser.js",
      "tests/reconnect.js",
      "tests/form.js",
      "tests/ui-workflow.js",
      "tests/activity-browser.js",
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, chrome: "readonly" },
    },
  },
];
