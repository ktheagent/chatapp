import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, formatBytes, isOfflineError } from "../src/utils.js";

test("esc escapes HTML-significant characters", () => {
  assert.equal(esc(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(esc("Kwame & Ama's chat"), "Kwame &amp; Ama&#39;s chat");
  assert.equal(esc(), "");
});

test("formatBytes renders human-friendly sizes for low-data placeholders", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(1024 * 1024 * 3), "3.0 MB");
  assert.equal(formatBytes(undefined), "");
  assert.equal(formatBytes(-5), "");
});

test("isOfflineError detects offline/network failures", () => {
  assert.equal(isOfflineError(new Error("boom"), false), true);
  assert.equal(isOfflineError({ name: "ConnectionError" }, true), true);
  assert.equal(isOfflineError(new Error("Failed to fetch"), true), true);
  assert.equal(isOfflineError(new Error("M_FORBIDDEN"), true), false);
  assert.equal(isOfflineError(new Error("M_FORBIDDEN")), true);
});
