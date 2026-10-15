import { describe, expect, test } from "bun:test";
import { vsbUrl } from "../../../frontend/src/lib/sections/config";
import { SourcePolicySchema } from "../../contracts/src/sources";
import { SOURCE_POLICIES, sourcePolicy, type SourcePolicy } from "../src/source-policies";

describe("SOURCE_POLICIES", () => {
  test.each(SOURCE_POLICIES.map((policy) => [policy.sourceId, policy] as const))("%s passes the contract", (_id, policy) => {
    expect(SourcePolicySchema.parse(policy)).toEqual({ ...policy, allowedUrlPrefixes: [...policy.allowedUrlPrefixes] });
  });

  test("each source is listed once", () => {
    const ids = SOURCE_POLICIES.map((policy) => policy.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the class-search source allows exactly the files the app fetches today", () => {
    const policy = sourcePolicy("vsb-untgrades");
    expect(policy.allowedUrlPrefixes).toEqual(["https://vsb.untgrades.app/data/"]);
    for (const url of [vsbUrl("spring-2027"), vsbUrl("spring-2027", "MATH")]) {
      expect(policy.allowedUrlPrefixes.some((prefix) => url.startsWith(prefix))).toBe(true);
    }
  });

  test("a policy can't be changed by whoever looks it up", () => {
    // Written as a caller that ignores the readonly types would write it.
    const policy = sourcePolicy("vsb-untgrades") as SourcePolicy;
    expect(() => {
      policy.approval = "disabled";
    }).toThrow(TypeError);
    expect(() => policy.allowedUrlPrefixes.push("https://example.com/")).toThrow(TypeError);
    expect(() => (SOURCE_POLICIES as SourcePolicy[]).push({ ...policy, sourceId: "unreviewed" })).toThrow(TypeError);
    expect(sourcePolicy("vsb-untgrades")).toMatchObject({ approval: "allowed", allowedUrlPrefixes: ["https://vsb.untgrades.app/data/"] });
    expect(SOURCE_POLICIES).toHaveLength(1);
  });

  test("a source with no policy throws", () => {
    expect(() => sourcePolicy("ratemyprofessors")).toThrow('No source policy for "ratemyprofessors"');
  });
});
