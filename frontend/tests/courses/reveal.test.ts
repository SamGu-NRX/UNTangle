import { describe, expect, test } from "bun:test";
import { parseDuration } from "@/components/courses/reveal";

describe("parseDuration", () => {
  test("reads a duration token as written and as the production minifier writes it", () => {
    expect(parseDuration("420ms")).toBe(420);
    expect(parseDuration(".42s")).toBe(420);
    expect(parseDuration(" 0.3s ")).toBe(300);
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("fast")).toBeNull();
  });
});
