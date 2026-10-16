/**
 * The week as a picture (Export, "Picture of the week"): the grid drawn on a
 * canvas at 2x, in the page's own fonts and course colors, so it reads like
 * the screen without screenshotting it.
 */
import { DAY_NAME, daysShown, hourRange, placeEvents, timeRange, type GridEvent } from "./week";

const SCALE = 2;
const WIDTH = 1200;
const HOUR = 56;
const HEAD = 96;
const GUTTER = 64;
const PAD = 32;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export async function drawWeekPng(input: { title: string; events: readonly GridEvent[]; hueOf: (code: string) => number; noSetTime: string[] }): Promise<Blob> {
  await document.fonts.ready;
  const days = daysShown(input.events);
  const { first, last } = hourRange(input.events);
  const footer = input.noSetTime.length > 0 ? 48 : 0;
  const height = HEAD + (last - first) * HOUR + footer + PAD;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the picture.");
  ctx.scale(SCALE, SCALE);

  const ui = getComputedStyle(document.body).fontFamily;
  const ink = cssVar("--ink");
  const ink2 = cssVar("--ink-2");
  const line = cssVar("--line");

  ctx.fillStyle = cssVar("--paper") || "#fff";
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.fillStyle = ink;
  ctx.font = `650 22px ${ui}`;
  ctx.fillText(input.title, PAD, 44);

  const columnWidth = (WIDTH - PAD * 2 - GUTTER) / days.length;
  const top = HEAD;
  ctx.font = `650 12px ${ui}`;
  ctx.fillStyle = ink2;
  days.forEach((day, i) => {
    ctx.textAlign = "center";
    ctx.fillText(DAY_NAME[day].slice(0, 3).toUpperCase(), PAD + GUTTER + columnWidth * (i + 0.5), top - 14);
  });
  ctx.textAlign = "right";
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  for (let hour = first; hour <= last; hour += 1) {
    const y = top + (hour - first) * HOUR + 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD + GUTTER, y);
    ctx.lineTo(WIDTH - PAD, y);
    ctx.stroke();
    if (hour > first && hour < last) {
      ctx.font = `400 11px ${ui}`;
      ctx.fillText(`${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`, PAD + GUTTER - 8, y + 4);
    }
  }
  ctx.textAlign = "left";

  // Events that share time sit side by side in lanes, as on the grid (WeekGrid).
  const placements = placeEvents(input.events);
  for (const event of input.events) {
    const column = days.indexOf(event.day);
    const hue = input.hueOf(event.courseCode);
    const { lane = 0, lanes = 1 } = placements.get(event.key) ?? {};
    const laneWidth = (columnWidth - 8) / lanes;
    const x = PAD + GUTTER + column * columnWidth + 4 + lane * laneWidth;
    const w = laneWidth - (lanes > 1 ? 2 : 0);
    const y = top + ((event.start - first * 60) / 60) * HOUR + 1;
    const h = ((event.end - event.start) / 60) * HOUR - 2;
    ctx.fillStyle = cssVar(`--c${hue}t`);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.fillStyle = cssVar(`--c${hue}`);
    ctx.fillRect(x, y + 4, 3, h - 8);
    ctx.fillStyle = ink;
    // DM Sans like the grid; Syne belongs to the wordmark alone.
    ctx.font = `600 13px ${ui}`;
    // A narrow lane condenses its text rather than spill into the next one.
    ctx.fillText(event.courseCode, x + 10, y + 18, w - 14);
    if (h > 36) {
      ctx.fillStyle = ink2;
      ctx.font = `400 12px ${ui}`;
      ctx.fillText(timeRange(event.start, event.end), x + 10, y + 34, w - 14);
    }
  }

  if (footer) {
    ctx.fillStyle = ink2;
    ctx.font = `650 11px ${ui}`;
    ctx.fillText("NO SET TIME", PAD, height - PAD - 10);
    ctx.font = `400 13px ${ui}`;
    ctx.fillStyle = ink;
    ctx.fillText(input.noSetTime.join(", "), PAD + 96, height - PAD - 10);
  }

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture couldn't be made."))), "image/png"));
}
