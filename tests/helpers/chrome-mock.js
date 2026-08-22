/**
 * chrome-mock.js — installable in-memory fake of the `chrome.*` surface
 * used by FocusGuard (background.js, popup/, blocked/).
 *
 * USAGE
 * -----
 *   import { installChromeMock, resetChromeMock } from "../helpers/chrome-mock.js";
 *
 *   beforeEach(() => {
 *     resetChromeMock(); // fresh storage, fresh listeners, fresh vi.fn() call history
 *   });
 *
 * `installChromeMock()` should be called once (e.g. in a `beforeAll`, or just
 * let the first `resetChromeMock()` do it — see below) to put a `chrome`
 * object on `globalThis`. `resetChromeMock()` is what you call between
 * tests: it discards ALL state (storage contents, registered listeners,
 * vi.fn() call histories, quota-failure flags) and installs a brand-new
 * mock, so tests never leak into each other. If `resetChromeMock()` is
 * called before `installChromeMock()` ever ran, it installs one for you —
 * so in practice a single `resetChromeMock()` in `beforeEach` is enough.
 *
 * EXPORTS
 * -------
 *   installChromeMock()                 -> the mock `chrome` object (also set as globalThis.chrome)
 *   resetChromeMock()                   -> same, but always fresh state
 *   simulateQuotaExceeded(area, value)  -> area: "sync" | "local", value: boolean (default true)
 *   triggerOnInstalled(details)         -> fires chrome.runtime.onInstalled listeners, awaits them
 *   triggerNavigation({url, frameId, tabId}) -> fires chrome.webNavigation.onBeforeNavigate listeners, awaits them
 *   FAKE_EXTENSION_ID                   -> the fake ID baked into chrome.runtime.getURL() output
 *
 * chrome.storage.sync / chrome.storage.local
 * -------------------------------------------
 * Each is a promise-based area (no callback style, matching how this
 * codebase calls it: `await chrome.storage.sync.get(...)`).
 *   get(keys)     keys may be:
 *                   - null or undefined -> returns the whole store
 *                   - a string          -> { [key]: value } (only if present)
 *                   - an array of strings -> { ...present keys }
 *                   - an object of defaults -> { ...stored values, falling back
 *                     to the object's own values for missing keys } (bonus,
 *                     mirrors real chrome.storage.get; not required by callers
 *                     in this codebase today but costs nothing to support)
 *   set(items)    merges `items` into the store. Rejects if a quota failure
 *                 has been armed via simulateQuotaExceeded() for this area.
 *   remove(keys)  string or array of strings.
 *   clear()       empties the area.
 * All four are `vi.fn()`-wrapped (real behavior, but inspectable —
 * `chrome.storage.sync.set.mock.calls` works).
 * Every successful set/remove/clear fires chrome.storage.onChanged listeners
 * synchronously (before the returned promise resolves) with the real
 * `(changes, areaName)` signature, where `changes` is
 * `{ [key]: { oldValue, newValue } }` and `areaName` is `"sync"` or `"local"`.
 * No-op calls (e.g. removing a key that isn't set) do NOT fire onChanged.
 *
 * Quota failures
 * --------------
 *   simulateQuotaExceeded("sync")        // arm: next AND all subsequent .set() calls on sync reject
 *   simulateQuotaExceeded("sync", false) // disarm
 * While armed, `chrome.storage.<area>.set(...)` rejects with
 * `new Error("QUOTA_BYTES quota exceeded")` and does not touch the store or
 * fire onChanged. Disarm it (or call resetChromeMock()) to recover.
 *
 * chrome.runtime
 * --------------
 *   chrome.runtime.getURL(path) -> `chrome-extension://${FAKE_EXTENSION_ID}/${path}`
 *     (leading slashes on `path` are stripped, matching real Chrome behavior)
 *   chrome.runtime.id -> FAKE_EXTENSION_ID
 *   chrome.runtime.onInstalled.addListener(fn) / removeListener(fn)
 *   triggerOnInstalled(details = { reason: "install" }) fires every
 *     registered onInstalled listener with `details` and awaits all of them
 *     (Promise.all), so `await triggerOnInstalled()` only resolves once any
 *     async onInstalled work (e.g. the DEFAULTS-seeding write) has settled.
 *   chrome.runtime.sendMessage -> vi.fn(() => Promise.resolve()) — inspect
 *     outgoing messages via chrome.runtime.sendMessage.mock.calls.
 *   chrome.runtime.onMessage.addListener(fn) / removeListener(fn)
 *   triggerMessage(message, sender) fires every registered onMessage
 *     listener with `(message, sender, sendResponse)` and awaits them.
 *
 * chrome.tabs
 * -----------
 *   chrome.tabs.update -> vi.fn((tabId, updateProperties) => Promise)
 *     Default implementation resolves with `{ id: tabId, ...updateProperties }`.
 *     Inspect calls via chrome.tabs.update.mock.calls, or override behavior
 *     per-test with chrome.tabs.update.mockRejectedValueOnce(...) etc.
 *   chrome.tabs.create -> vi.fn((createProperties) => Promise)
 *     Default implementation resolves with `{ id: 9999, ...createProperties }`.
 *     Inspect calls via chrome.tabs.create.mock.calls.
 *   chrome.tabs.remove -> vi.fn((tabId) => Promise)
 *     Default implementation resolves with `undefined`, matching real Chrome.
 *     Inspect calls via chrome.tabs.remove.mock.calls.
 *
 * chrome.webNavigation
 * --------------------
 *   chrome.webNavigation.onBeforeNavigate.addListener(fn) / removeListener(fn)
 *   triggerNavigation({ url, frameId = 0, tabId = 1 }) fires every
 *     registered onBeforeNavigate listener with `{ url, frameId, tabId }` and
 *     awaits all of them (Promise.all) — use this to drive background.js's
 *     redirect logic end to end in a test, e.g.:
 *       await triggerNavigation({ url: "https://example.com/", tabId: 7 });
 *       expect(chrome.tabs.update).toHaveBeenCalledWith(7, expect.objectContaining({ url: expect.stringContaining("blocked.html") }));
 *
 * Dependency-free apart from `vi` (from vitest).
 */

import { vi } from "vitest";

export const FAKE_EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function createStorageArea(areaName, dispatchChange, quotaState) {
  let store = {};

  async function get(keys) {
    if (keys === null || keys === undefined) {
      return cloneValue(store);
    }
    if (typeof keys === "string") {
      const result = {};
      if (Object.prototype.hasOwnProperty.call(store, keys)) {
        result[keys] = cloneValue(store[keys]);
      }
      return result;
    }
    if (Array.isArray(keys)) {
      const result = {};
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(store, key)) {
          result[key] = cloneValue(store[key]);
        }
      }
      return result;
    }
    if (typeof keys === "object") {
      // Object of { key: defaultValue }
      const result = {};
      for (const key of Object.keys(keys)) {
        result[key] = Object.prototype.hasOwnProperty.call(store, key)
          ? cloneValue(store[key])
          : cloneValue(keys[key]);
      }
      return result;
    }
    return {};
  }

  async function set(items) {
    if (quotaState.exceeded) {
      throw new Error("QUOTA_BYTES quota exceeded");
    }
    const changes = {};
    for (const key of Object.keys(items)) {
      const oldValue = Object.prototype.hasOwnProperty.call(store, key)
        ? cloneValue(store[key])
        : undefined;
      const newValue = cloneValue(items[key]);
      store[key] = newValue;
      changes[key] = { oldValue, newValue };
    }
    if (Object.keys(changes).length > 0) {
      dispatchChange(changes, areaName);
    }
  }

  async function remove(keys) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    const changes = {};
    for (const key of keyList) {
      if (Object.prototype.hasOwnProperty.call(store, key)) {
        changes[key] = { oldValue: cloneValue(store[key]), newValue: undefined };
        delete store[key];
      }
    }
    if (Object.keys(changes).length > 0) {
      dispatchChange(changes, areaName);
    }
  }

  async function clear() {
    const changes = {};
    for (const key of Object.keys(store)) {
      changes[key] = { oldValue: cloneValue(store[key]), newValue: undefined };
    }
    store = {};
    if (Object.keys(changes).length > 0) {
      dispatchChange(changes, areaName);
    }
  }

  const area = {
    get: vi.fn(get),
    set: vi.fn(set),
    remove: vi.fn(remove),
    clear: vi.fn(clear),
  };
  // Internal handle used only by simulateQuotaExceeded(); not part of the
  // public chrome.* surface.
  area._quotaState = quotaState;
  return area;
}

function buildMock() {
  // chrome.storage.onChanged is shared across both areas — a single
  // listener list, distinguished by the areaName argument, matching real
  // Chrome.
  const changeListeners = new Set();
  function dispatchChange(changes, areaName) {
    for (const fn of changeListeners) fn(changes, areaName);
  }

  const syncQuota = { exceeded: false };
  const localQuota = { exceeded: false };

  const storage = {
    sync: createStorageArea("sync", dispatchChange, syncQuota),
    local: createStorageArea("local", dispatchChange, localQuota),
    onChanged: {
      addListener: (fn) => changeListeners.add(fn),
      removeListener: (fn) => changeListeners.delete(fn),
      hasListener: (fn) => changeListeners.has(fn),
      _listeners: changeListeners,
    },
  };

  const onInstalledListeners = new Set();
  const onMessageListeners = new Set();
  const runtime = {
    id: FAKE_EXTENSION_ID,
    getURL: (path) =>
      `chrome-extension://${FAKE_EXTENSION_ID}/${String(path ?? "").replace(/^\/+/, "")}`,
    sendMessage: vi.fn(() => Promise.resolve()),
    onInstalled: {
      addListener: (fn) => onInstalledListeners.add(fn),
      removeListener: (fn) => onInstalledListeners.delete(fn),
      _listeners: onInstalledListeners,
    },
    onMessage: {
      addListener: (fn) => onMessageListeners.add(fn),
      removeListener: (fn) => onMessageListeners.delete(fn),
      _listeners: onMessageListeners,
    },
  };

  const tabs = {
    update: vi.fn((tabId, updateProperties) =>
      Promise.resolve({ id: tabId, ...updateProperties })
    ),
    create: vi.fn((createProperties) =>
      Promise.resolve({ id: 9999, ...createProperties })
    ),
    remove: vi.fn(() => Promise.resolve()),
  };

  const onBeforeNavigateListeners = new Set();
  const webNavigation = {
    onBeforeNavigate: {
      addListener: (fn) => onBeforeNavigateListeners.add(fn),
      removeListener: (fn) => onBeforeNavigateListeners.delete(fn),
      _listeners: onBeforeNavigateListeners,
    },
  };

  return { storage, runtime, tabs, webNavigation };
}

let currentMock = null;

export function installChromeMock() {
  const mock = buildMock();
  currentMock = mock;
  globalThis.chrome = mock;
  return mock;
}

export function resetChromeMock() {
  return installChromeMock();
}

function requireMock() {
  if (!currentMock) {
    throw new Error(
      "chrome-mock: no mock installed yet. Call installChromeMock() or resetChromeMock() first."
    );
  }
  return currentMock;
}

export function simulateQuotaExceeded(area, value = true) {
  const mock = requireMock();
  if (area !== "sync" && area !== "local") {
    throw new Error(
      `simulateQuotaExceeded: area must be "sync" or "local", got ${JSON.stringify(area)}`
    );
  }
  mock.storage[area]._quotaState.exceeded = value;
}

export async function triggerOnInstalled(details = { reason: "install" }) {
  const mock = requireMock();
  const results = [];
  for (const fn of mock.runtime.onInstalled._listeners) {
    results.push(fn(details));
  }
  await Promise.all(results);
}

export async function triggerNavigation({ url, frameId = 0, tabId = 1 } = {}) {
  const mock = requireMock();
  const details = { url, frameId, tabId };
  const results = [];
  for (const fn of mock.webNavigation.onBeforeNavigate._listeners) {
    results.push(fn(details));
  }
  await Promise.all(results);
}

export async function triggerMessage(message, sender = {}) {
  const mock = requireMock();
  const sendResponse = () => {};
  const results = [];
  for (const fn of mock.runtime.onMessage._listeners) {
    results.push(fn(message, sender, sendResponse));
  }
  await Promise.all(results);
}
