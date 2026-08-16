// Flat ESLint config (ESLint 9+/10+ default format — no .eslintrc needed).
//
// This is a correctness gate, not a style crusade: it catches unused vars,
// undefined references, and unreachable/broken code. It deliberately does
// NOT enable stylistic or opinionated rules (quotes, semicolons, etc.) so it
// doesn't fight with whatever formatting the source-rewrite agents land.
//
// The extension itself is buildless and ships plain scripts read straight
// off disk by Chrome — this config exists purely for local linting, it is
// never invoked by the extension at runtime.

import globals from "globals";

const browserExtensionGlobals = {
  ...globals.browser,
  ...globals.webextensions,
};

export default [
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      ".vitest/**",
    ],
  },
  {
    // Extension source (background.js, lib/, popup/, blocked/) and the test
    // harness itself. `chrome`, `window`, `document`, `AudioContext`, etc.
    // are all real globals here, not undefined references.
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: browserExtensionGlobals,
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-unreachable-loop": "error",
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-dupe-class-members": "error",
      "no-duplicate-case": "error",
      "no-fallthrough": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-import-assign": "error",
      "no-obj-calls": "error",
      "no-setter-return": "error",
      "no-class-assign": "error",
      "no-func-assign": "error",
      "no-invalid-regexp": "error",
      "no-irregular-whitespace": "error",
      "valid-typeof": "error",
      "use-isnan": "error",
      "no-cond-assign": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
  {
    // Node-authored tooling config files (this one included) and anything
    // under tests/ run under Node via Vitest, not inside a browser tab —
    // give them Node globals (process, __dirname-equivalents, etc.) on top
    // of the browser/webextension ones (chrome-mock.js emulates a browser).
    files: ["*.config.js", "tests/**/*.js"],
    languageOptions: {
      globals: {
        ...browserExtensionGlobals,
        ...globals.node,
      },
    },
  },
];
