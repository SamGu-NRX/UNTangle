import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildSectionRelease } from "../../ingest/src/section-release";
import { SOURCE_POLICIES, sourcePolicy } from "../../ingest/src/source-policies";
import { ReleaseManifestSchema, SectionReleaseSchema } from "../src/section-release";
import { SourcePolicySchema } from "../src/sources";
import { rejections } from "./helpers";

function release() {
  const result = buildSectionRelease({
    body: readFileSync(new URL("../../ingest/tests/fixtures/vsb-spring-2027.json", import.meta.url), "utf8"),
    sourceId: "vsb-untgrades", institutionId: "unt", termId: "spring-2027", fetchedAt: "2026-10-14T18:00:00Z",
  });
  if (!result.ok) throw new Error(result.message);
  return result.release;
}

describe("release and policy consistency", () => {
  test.each(["courses", "coursesWithSections", "coursesWithNoClasses", "invalidCourses", "sections", "components", "meetings"] as const)("checks the actual %s count", key => {
    const valid = release();
    expect(SectionReleaseSchema.parse(valid)).toEqual(valid);
    const counts = { ...valid.manifest.counts, [key]: valid.manifest.counts[key] + 1 };
    expect(rejections(SectionReleaseSchema, { ...valid, manifest: { ...valid.manifest, counts } })).toEqual([
      `manifest.counts.${key}: The manifest counts ${counts[key]}; the release holds ${valid.manifest.counts[key]}.`,
    ]);
  });
  test("the manifest and the policy reject VSB data labeled UT Austin", () => {
    const valid = release();
    expect(ReleaseManifestSchema.parse(valid.manifest)).toEqual(valid.manifest);
    expect(rejections(ReleaseManifestSchema, { ...valid.manifest, institutionId: "ut-austin" })).toEqual([
      "institutionId: The vsb-untgrades source belongs to unt.",
    ]);
    expect(rejections(SectionReleaseSchema, { ...valid, manifest: { ...valid.manifest, institutionId: "ut-austin" } })).toContain(
      "manifest.institutionId: The vsb-untgrades source belongs to unt.",
    );
    const policy = sourcePolicy("vsb-untgrades");
    expect(SourcePolicySchema.parse(policy).institutionId).toBe("unt");
    expect(rejections(SourcePolicySchema, { ...policy, institutionId: "ut-austin" })).toEqual([
      "institutionId: The vsb-untgrades source belongs to unt.",
    ]);
  });
  test("every reviewed source has its institution and a bounded aggregate server budget", () => {
    for (const policy of SOURCE_POLICIES) {
      expect(SourcePolicySchema.parse(policy)).toEqual({ ...policy, allowedUrlPrefixes: [...policy.allowedUrlPrefixes] });
      expect(rejections(SourcePolicySchema, { ...policy, institutionId: undefined })).toHaveLength(1);
      if (policy.acquisition === "server" && policy.approval === "allowed") {
        expect(rejections(SourcePolicySchema, { ...policy, maxRequestsPerHour: null })).toEqual([
          "maxRequestsPerHour: An allowed server source has an aggregate hourly request cap.",
        ]);
      }
    }
  });
  test("adding subject and term URLs cannot remove the aggregate cap", () => {
    const policy = sourcePolicy("vsb-untgrades");
    const multiplePaths = { ...policy, allowedUrlPrefixes: ["https://vsb.untgrades.app/data/terms/", "https://vsb.untgrades.app/data/subjects/"] };
    expect(SourcePolicySchema.parse(multiplePaths).maxRequestsPerHour).toBe(4);
    expect(rejections(SourcePolicySchema, { ...multiplePaths, maxRequestsPerHour: null })).toEqual([
      "maxRequestsPerHour: An allowed server source has an aggregate hourly request cap.",
    ]);
  });
});
