"use client";

import { useRef, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { CalendarGlyph, CopyGlyph, ImageGlyph, ShareGlyph } from "@/components/ui/icons";
import { classNumbersText, orderClassNumbers } from "@/lib/export/class-numbers";
import { termDatesFor } from "@/lib/export/term-dates";
import { buildWeekIcs, icsFileName } from "@/lib/planner-ics";
import type { Section } from "@/lib/sections";
import styles from "./builder.module.css";
import type { BuilderHost } from "./host";
import { decodeFile, encodeFile, encodeShare, type SharedWeek } from "./share";
import { sectionLabel, type GridEvent } from "./week";
import { drawWeekPng } from "./week-png";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const day = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`));
/** "Mar 8–14", "Mar 29–Apr 2". */
function dayRange(begin: string, end: string): string {
  if (begin === end) return day(begin);
  const [startMonth] = day(begin).split(" ");
  const [endMonth, endDay] = day(end).split(" ");
  return `${day(begin)}–${startMonth === endMonth ? endDay : `${endMonth} ${endDay}`}`;
}

/** Whether the text reached the clipboard: a browser can refuse without a user gesture or permission. */
async function copied(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const COPY_BLOCKED = "This browser blocked copying. Select the text and copy it instead.";

/** The part of Export an outcome belongs to. */
type Place = "numbers" | "ics" | "png" | "share";
type Note = { at: Place; text: string; failed: boolean };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: boolean;
  host: BuilderHost;
  /** The sections on the week, in course order. */
  sections: readonly Section[];
  events: readonly GridEvent[];
  hueOf: (code: string) => number;
  scheduleName: string;
  onOpenWeek: (week: SharedWeek) => void;
};

/** Export (DESIGN.md §4.3): the same four outputs in both hosts, class numbers first. */
export function ExportSheet({ open, onOpenChange, phone, host, sections, events, hueOf, scheduleName, onOpenWeek }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  // What the last action did, said beside its control: the sheet covers where a toast would show on a phone,
  // and the page under it, toast included, is inert. A new opening starts clean.
  const [note, setNote] = useState<Note | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setNote(null);
  }
  const say = (at: Place, text: string, failed = false) => setNote({ at, text, failed });
  const copy = async (at: Place, text: string, done: string) => (await copied(text) ? say(at, done) : say(at, COPY_BLOCKED, true));
  const noteFor = (at: Place) => (
    <>
      <p className={styles.exportNote} role="status">
        {note?.at === at && !note.failed ? note.text : null}
      </p>
      {note?.at === at && note.failed ? (
        <p className={styles.exportNote} data-failed="" role="alert">
          {note.text}
        </p>
      ) : null}
    </>
  );
  const titleOf = (code: string) => host.courses.find((course) => course.code === code)?.title;
  const rows = orderClassNumbers(
    sections.map((section) => {
      // A section's own count is its primary row's (INTEGRATION.md); the scarcest component it needs is what fills first.
      const known = section.components.flatMap((c) => (c.seats.open === null ? [] : [c.seats.open]));
      return {
        courseCode: section.courseCode,
        sectionLabel: sectionLabel(section),
        classNumbers: section.term === null ? [] : section.components.flatMap((c) => (c.classNumber ? [c.classNumber] : [])),
        openSeats: known.length > 0 ? Math.min(...known) : null,
      };
    }),
  );
  const count = rows.reduce((sum, row) => sum + row.classNumbers.length, 0);
  const without = sections.filter((section) => !rows.some((row) => row.courseCode === section.courseCode)).map((s) => s.courseCode);
  const term = termDatesFor(host.term.label);
  const spring = term?.breaks.find((b) => /spring break/i.test(b.name));
  const week: SharedWeek = { term: host.term.id, sections: Object.fromEntries(sections.map((s) => [s.courseCode, s.id])) };
  const empty = sections.length === 0;

  const body = (
    <div className={styles.export}>
      <section className={styles.exportSection} aria-labelledby="export-numbers">
        <h3 id="export-numbers" className={styles.exportHead}>
          <span aria-hidden="true">#</span>
          Class numbers for myUNT
        </h3>
        {rows.length > 0 ? (
          <>
            <ol className={styles.numbers}>
              {rows.map((row) => (
                <li key={row.courseCode}>
                  <b>{row.classNumbers.join(" ")}</b>
                  <span>
                    {row.courseCode} §{row.sectionLabel}
                  </span>
                  {row.fewSeats ? <em>Few seats</em> : null}
                </li>
              ))}
            </ol>
            <p className={styles.meta}>Add them to your myUNT cart from the top. The fewest open seats come first.</p>
            {without.length > 0 ? <p className={styles.meta}>Sample sections have no class numbers: pick real ones for {without.join(" and ")}.</p> : null}
            <Button icon={<CopyGlyph size={18} />} className={styles.start} onClick={() => copy("numbers", classNumbersText(rows), `Copied ${count} class number${count === 1 ? "" : "s"}`)}>
              Copy all {count}
            </Button>
            {noteFor("numbers")}
          </>
        ) : (
          <p className={styles.meta}>{empty ? "Add a class to get its class number." : "Sample sections have no class numbers. Pick real sections first."}</p>
        )}
      </section>

      <section className={styles.exportSection} aria-labelledby="export-ics">
        <h3 id="export-ics" className={styles.exportHead}>
          <CalendarGlyph size={18} />
          Calendar file
        </h3>
        <p className={styles.meta}>
          {term
            ? `${term.term}, ${day(term.first)} to ${day(term.last)}. Weekly repeats skip${spring ? ` spring break (${dayRange(spring.begin, spring.end)}) and other days off` : " days off"}. Classes with no set time are left out.`
            : `There's no calendar for ${host.term.label} yet, so no file can be made.`}
        </p>
        <Button
          variant="secondary"
          className={styles.start}
          disabled={!term || empty}
          onClick={() => {
            if (!term) return;
            const result = buildWeekIcs(sections, term, { titleOf, calendarName: `${host.term.label} ${scheduleName}` });
            download(new Blob([result.ics], { type: "text/calendar;charset=utf-8" }), icsFileName(term));
            say("ics", `Downloaded ${result.eventCount} weekly class${result.eventCount === 1 ? "" : "es"}`);
          }}
        >
          Download .ics
        </Button>
        {noteFor("ics")}
      </section>

      <section className={styles.exportSection} aria-labelledby="export-png">
        <h3 id="export-png" className={styles.exportHead}>
          <ImageGlyph size={18} />
          Picture of the week
        </h3>
        <Button
          variant="secondary"
          className={styles.start}
          disabled={empty}
          onClick={() =>
            drawWeekPng({
              title: `${host.term.label} ${scheduleName}`,
              events,
              hueOf,
              noSetTime: sections.filter((s) => !events.some((e) => e.courseCode === s.courseCode)).map((s) => s.courseCode),
            }).then(
              (blob) => download(blob, `${host.term.id}-week.png`),
              (error: Error) => say("png", error.message, true),
            )
          }
        >
          Download .png
        </Button>
        {noteFor("png")}
      </section>

      <section className={styles.exportSection} aria-labelledby="export-share">
        <h3 id="export-share" className={styles.exportHead}>
          <ShareGlyph size={18} />
          Share and back up
        </h3>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" disabled={empty} onClick={() => copy("share", host.shareUrl(encodeShare(week)), "Copied the share link")}>
            Copy share link
          </Button>
          <Button variant="secondary" size="sm" disabled={empty} onClick={() => window.location.assign(host.printHref)}>
            Print
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={empty}
            onClick={() => download(new Blob([encodeFile(week)], { type: "application/json" }), `${host.term.id}-${scheduleName.toLowerCase()}.json`)}
          >
            Save file
          </Button>
          <Button variant="ink" size="sm" onClick={() => fileInput.current?.click()}>
            Open a file
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const opened = decodeFile(await file.text());
              if ("error" in opened) {
                say("share", opened.error, true);
                return;
              }
              onOpenChange(false);
              onOpenWeek(opened);
            }}
          />
        </div>
        {noteFor("share")}
      </section>
    </div>
  );

  const title = `Export ${scheduleName}`;
  return phone ? (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={title} detents={["92%"]} header={<h2 className={styles.sheetTitle}>{title}</h2>}>
      {body}
    </BottomSheet>
  ) : (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} width={480}>
      {body}
    </Dialog>
  );
}
