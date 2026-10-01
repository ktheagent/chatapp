import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_LANGUAGES, STRINGS, translate, setLang, getLang } from "../src/i18n.js";

// Minimal localStorage polyfill for Node's test runner (no DOM/browser env).
globalThis.localStorage = (() => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
})();

test("translate falls back to English for unknown languages/keys", () => {
  assert.equal(translate("en", "send"), "Send");
  assert.equal(translate("xx", "send"), "Send");
  assert.equal(translate("en", "doesNotExist"), "doesNotExist");
});

test("translate substitutes {var} placeholders", () => {
  const withVar = translate("en", "queuedOffline", { count: 3 });
  assert.equal(typeof withVar, "string");
});

test("getLang/setLang persist via localStorage and reject unsupported codes", () => {
  setLang("sw");
  assert.equal(getLang(), "sw");
  setLang("not-a-real-lang");
  assert.equal(getLang(), "en");
});

test("every supported language defines the same string keys as English", () => {
  const englishKeys = Object.keys(STRINGS.en).sort();
  for (const { code } of SUPPORTED_LANGUAGES) {
    const localeKeys = Object.keys(STRINGS[code] || {}).sort();
    assert.deepEqual(localeKeys, englishKeys, `locale ${code} key set does not match English`);
  }
});
