import { describe, expect, test } from "bun:test";
import type { ExpressionSpecification } from "maplibre-gl";
import { dayLabelFilters } from "@/components/map/building-highlight";

const isLabel: ExpressionSpecification = ["==", ["get", "k"], "lb"];

describe("dayLabelFilters", () => {
  test("without a starting point, the day layer holds the class buildings by registry id", () => {
    const isClass: ExpressionSpecification = ["in", ["get", "c"], ["literal", ["gab", "env"]]];
    expect(dayLabelFilters(["gab", "env"], null)).toEqual({
      day: ["all", isLabel, isClass],
      quiet: ["all", isLabel, ["!", isClass]],
    });
  });

  test("the starting building joins by its exact name or its name before the code", () => {
    // The detail file labels Kerr Hall "Kerr Hall (KERR)"; the starting point is named "Kerr Hall".
    // Matching "Kerr Hall (" at the start keeps "Kerr Hall West (KERW)" out.
    const isPlace: ExpressionSpecification = [
      "any",
      ["in", ["get", "c"], ["literal", ["gab"]]],
      ["==", ["get", "n"], "Kerr Hall"],
      ["==", ["index-of", "Kerr Hall (", ["get", "n"]], 0],
    ];
    expect(dayLabelFilters(["gab"], "Kerr Hall")).toEqual({
      day: ["all", isLabel, isPlace],
      quiet: ["all", isLabel, ["!", isPlace]],
    });
  });
});
