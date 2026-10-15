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
    expect(SOURCE_POLICIES).toHaveLength(2);
  });

  describe("catalog-utexas", () => {
    test("covers exactly the saved course pages the UT Austin parser reads", () => {
      const policy = sourcePolicy("catalog-utexas");
      expect(policy.institutionId).toBe("ut-austin");
      expect(policy.approval).toBe("allowed");
      expect(policy.acquisition).toBe("server");
      expect(policy.minIntervalMs).toBeGreaterThan(0);
      expect(policy.maxConcurrency).toBe(1);
      for (const url of ["https://catalog.utexas.edu/courses/c_s/", "https://catalog.utexas.edu/courses/m/", "https://catalog.utexas.edu/courses/phy/"]) {
        expect(policy.allowedUrlPrefixes.some((prefix) => url.startsWith(prefix))).toBe(true);
      }
      // The interactive schedule app is EID-gated and no page outside the
      // course tree may be fetched by a job.
      expect(policy.allowedUrlPrefixes.some((prefix) => "https://utdirect.utexas.edu/apps/registrar/course_schedule/20269".startsWith(prefix))).toBe(false);
      expect(policy.allowedUrlPrefixes.some((prefix) => "https://catalog.utexas.edu/undergraduate/".startsWith(prefix))).toBe(false);
    });
  });

  test("a source with no policy throws", () => {
    expect(() => sourcePolicy("ratemyprofessors")).toThrow('No source policy for "ratemyprofessors"');
  });
});
