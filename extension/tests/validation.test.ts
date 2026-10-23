import { expect, test } from "bun:test";
import { validateMessage } from "../src/shared/validation";
const ref = { term: "spring-2027", classNumber: "14523" };
const sender: chrome.runtime.MessageSender = { id: "our-extension", tab: { id: 1, url: "http://localhost:4317/class-search", index: 0, pinned: false, highlighted: false, windowId: 1, active: true, incognito: false, selected: true, discarded: false, autoDiscardable: true, groupId: -1, frozen: false }, frameId: 0, url: "http://localhost:4317/class-search", origin: "http://localhost:4317" };
const panel: chrome.runtime.MessageSender = { id: "our-extension", url: "chrome-extension://our-extension/popup.html" };
test("the valid page allowlist only exposes markers and proposals", () => {
  expect(validateMessage({ type: "marker/request", ref }, sender, "our-extension")).toEqual({ type: "marker/request", ref });
  expect(validateMessage({ type: "proposal/request", ref }, sender, "our-extension")).not.toBeNull();
});
test("forged ids, absent tabs, hostile top frames and hostile child frames are rejected", () => {
  for (const forged of [{ ...sender, id: "other" }, { ...sender, tab: undefined }, { ...sender, url: "https://login.unt.edu/" }, { ...sender, tab: { ...sender.tab!, url: "https://evil.test" } }, { ...sender, frameId: undefined }, { ...sender, frameId: -1 }, { ...sender, origin: "https://evil.test" }])
    expect(validateMessage({ type: "marker/request", ref }, forged, "our-extension")).toBeNull();
});
test("page messages accept only the exact class-search route and its descendants", () => {
  for (const pathname of ["/class-search", "/class-search/results"])
    expect(validateMessage({ type: "marker/request", ref }, { ...sender, url: `http://localhost:4317${pathname}`, tab: { ...sender.tab!, url: `http://localhost:4317${pathname}` } }, "our-extension")).not.toBeNull();
  for (const pathname of ["/class-search-evil", "/class-searchx"])
    expect(validateMessage({ type: "marker/request", ref }, { ...sender, url: `http://localhost:4317${pathname}`, tab: { ...sender.tab!, url: `http://localhost:4317${pathname}` } }, "our-extension")).toBeNull();
});
test("page messages cannot confirm, sign in, request details or supply URLs", () => {
  for (const message of [{ type: "panel/confirm", previewId: "known" }, { type: "panel/sign-in" }, { type: "add/request", ref }, { type: "fetch", url: "https://evil.test" }, { type: "marker/request", ref, url: "https://evil.test" }, { type: "marker/request", ref: { ...ref, term: "../account" } }, { type: "marker/request", ref: { ...ref, classNumber: 12345 } }, { type: "marker/request", ref: { ...ref, url: "https://evil.test" } }, null])
    expect(validateMessage(message, sender, "our-extension")).toBeNull();
});
test("only the exact trusted popup may confirm a known-shaped preview id", () => {
  expect(validateMessage({ type: "panel/confirm", previewId: "preview-1" }, panel, "our-extension")).not.toBeNull();
  for (const forged of [{ ...panel, url: "chrome-extension://our-extension/other.html" }, { ...panel, id: "other" }, { ...panel, tab: sender.tab }])
    expect(validateMessage({ type: "panel/confirm", previewId: "preview-1" }, forged, "our-extension")).toBeNull();
  expect(validateMessage({ type: "panel/confirm", previewId: "https://evil.test" }, panel, "our-extension")).toBeNull();
});
