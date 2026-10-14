import { describe, expect, test } from "bun:test";
import { brandFor, hostIdFor } from "@/lib/brand";

describe("hostIdFor", () => {
  test("the standalone hostname is vsb, whatever its case or port", () => {
    expect(hostIdFor("vsb.untgrades.app")).toBe("vsb");
    expect(hostIdFor("VSB.untgrades.app:443")).toBe("vsb");
  });

  test("every other host is UNTangle", () => {
    expect(hostIdFor("untangleapp.vercel.app")).toBe("untangle");
    expect(hostIdFor("localhost:3000")).toBe("untangle");
    expect(hostIdFor("untgrades.app")).toBe("untangle");
    expect(hostIdFor(null)).toBe("untangle");
  });

  test("?host= names a product either way, and anything else is ignored", () => {
    expect(hostIdFor("localhost:3000", "vsb")).toBe("vsb");
    expect(hostIdFor("vsb.untgrades.app", "untangle")).toBe("untangle");
    expect(hostIdFor("localhost:3000", "VSB")).toBe("vsb");
    expect(hostIdFor("localhost:3000", "other")).toBe("untangle");
  });
});

describe("brandFor", () => {
  test("the standalone builder has no account, a term picker and the freshness line", () => {
    const vsb = brandFor("vsb");
    expect(vsb.name).toBe("UNT Schedule Builder");
    expect(vsb.primaryLabel).toBe("Build my schedule");
    expect([vsb.accounts, vsb.termPicker, vsb.freshness, vsb.suggestions]).toEqual([false, true, true, false]);
  });

  test("UNTangle keeps the account and Auto", () => {
    const untangle = brandFor("untangle");
    expect(untangle.name).toBe("UNTangle");
    expect(untangle.primaryLabel).toBe("Auto");
    expect([untangle.accounts, untangle.termPicker, untangle.freshness, untangle.suggestions]).toEqual([true, false, false, true]);
  });
});
