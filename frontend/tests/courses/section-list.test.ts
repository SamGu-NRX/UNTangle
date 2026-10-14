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

test("a section's times read as one pattern per distinct time, in UNT's day letters", async () => {
  const { meetingPatterns } = await import("@/components/courses/SectionList");
  const at = (day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat", startMinutes: number, endMinutes: number) => ({ day, startMinutes, endMinutes });
  const lectureAndLab = {
    online: false,
    async: false,
    meetings: [at("Mon", 600, 650), at("Wed", 600, 650), at("Fri", 600, 650), at("Thu", 840, 950), at("Sat", 540, 650)],
  };
  expect(meetingPatterns(lectureAndLab)).toEqual(["MWF 10:00–10:50", "R 2:00–3:50", "S 9:00–10:50"]);
  expect(meetingPatterns({ online: true, async: true, meetings: [] })).toEqual(["Online, no set time"]);
  expect(meetingPatterns({ online: false, async: false, meetings: [] })).toEqual(["Time to be announced"]);
});
