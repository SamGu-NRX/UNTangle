import { describe, expect, test } from "bun:test";
import { startMap } from "@/components/map/start-map";

describe("startMap", () => {
  test("returns the map when the constructor works", () => {
    const map = { id: 1 };
    expect(startMap(() => map)).toEqual({ ok: true, map });
  });

  test("turns a constructor that throws (no WebGL) into a reason instead of an error", () => {
    const started = startMap(() => {
      throw new Error("Failed to initialize WebGL");
    });
    expect(started).toEqual({ ok: false, reason: "Failed to initialize WebGL" });
  });
});
