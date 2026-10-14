import { expect, mock, test } from "bun:test";

mock.module("@/components/courses/courses.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

test("a room shows only when the location carries a number after its building code", async () => {
  const { roomNumber } = await import("@/components/courses/SectionList");
  expect(roomNumber({ room: "GAB 535", buildingCode: "GAB" })).toBe("535");
  expect(roomNumber({ room: "ENV B190", buildingCode: "ENV" })).toBe("B190");
  expect(roomNumber({ room: "Life Sciences Complex", buildingCode: "LIFE" })).toBeUndefined();
  expect(roomNumber({ room: "GAB", buildingCode: "GAB" })).toBeUndefined();
  expect(roomNumber({ room: "CURY 204", buildingCode: null })).toBeUndefined();
});

test("the mini week adds Saturday and Sunday only when a meeting falls on them", async () => {
  const { weekDays } = await import("@/components/courses/SectionList");
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
  expect(weekDays([{ day: "Mon" }, { day: null }])).toEqual([...weekdays]);
  expect(weekDays([{ day: "Sat" }])).toEqual([...weekdays, "Sat"]);
  expect(weekDays([{ day: "Sun" }, { day: "Sat" }])).toEqual([...weekdays, "Sat", "Sun"]);
});
