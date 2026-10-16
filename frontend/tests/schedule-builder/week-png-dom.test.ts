/**
 * Export's picture of the week, drawn on a canvas that records each event's
 * box: events sharing time sit in lanes, as on the grid.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { eventsOf } from "@/components/schedule-builder/week";
import { installDom, removeDom } from "../ui/dom";
import { meeting, section } from "./fixtures";

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

test("events that share time are drawn side by side, not on top of each other", async () => {
  const { drawWeekPng } = await import("@/components/schedule-builder/week-png");
  const boxes: Array<{ x: number; width: number }> = [];
  // Every drawing call is a no-op except roundRect, which draws an event's box.
  const context = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_, key) => (key === "roundRect" ? (x: number, _y: number, width: number) => boxes.push({ x, width }) : () => {}),
    set: () => true,
  });
  const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (done: (blob: Blob) => void) => done(new Blob()) };
  const createElement = document.createElement.bind(document);
  document.createElement = ((tag: string) => (tag === "canvas" ? canvas : createElement(tag))) as typeof document.createElement;
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
  try {
    const firstHalf = section({ courseCode: "SPAN 2040", meetings: [meeting({ day: "Mon", at: "9:00", until: "9:50", dates: { start: "2027-01-11", end: "2027-03-05" } })] });
    const secondHalf = section({ courseCode: "SPAN 2050", meetings: [meeting({ day: "Mon", at: "9:00", until: "9:50", dates: { start: "2027-03-15", end: "2027-05-07" } })] });
    const alone = section({ courseCode: "HIST 2610", meetings: [meeting({ day: "Tue", at: "9:00", until: "9:50" })] });
    await drawWeekPng({ title: "Main", events: eventsOf([firstHalf, secondHalf, alone]), hueOf: () => 1, noSetTime: [] });
    // Five columns of (1200 - 2 * 32 - 64) / 5 = 214.4px, each inset 4px either side.
    expect(boxes.map(({ x, width }) => [Math.round(x * 10) / 10, Math.round(width * 10) / 10])).toEqual([
      [100, 101.2],
      [203.2, 101.2],
      [314.4, 206.4],
    ]);
  } finally {
    document.createElement = createElement as typeof document.createElement;
  }
});
