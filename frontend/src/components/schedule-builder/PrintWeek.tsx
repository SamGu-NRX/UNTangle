"use client";

import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { assignColors } from "@/lib/course-colors";
import styles from "./builder.module.css";
import type { BuilderHost } from "./host";
import { eventsOf, patternOf, placeEvents, sectionLabel, walksOf } from "./week";
import { WeekGrid } from "./WeekGrid";

const noop = () => undefined;

/**
 * The week on paper: the grid, then one row per course with what a printout
 * is for (section, time, room, instructor, class numbers). The print dialog
 * opens once the sections have loaded; Back and Print stay off the paper.
 */
export function PrintWeek({ host, backHref, title }: { host: BuilderHost; backHref: string; title: string }) {
  const sections = host.courses.flatMap((course) => (course.section ? [course.section] : []));
  const loading = host.courses.some((course) => course.state === "loading");
  const events = eventsOf(sections);
  const hues = useMemo(() => assignColors(host.courses.map((c) => ({ id: c.code, department: c.code.split(" ")[0] }))), [host.courses]);
  const printed = useRef(false);

  useEffect(() => {
    if (loading || printed.current || host.courses.length === 0) return;
    printed.current = true;
    // One frame so the grid has laid out before the print snapshot.
    requestAnimationFrame(() => window.print());
  }, [host.courses.length, loading]);

  return (
    <main className={styles.print}>
      <div className={styles.printControls}>
        <a href={backHref} className="ui-btn ui-btn--secondary ui-btn--sm" data-ui="">
          Back to Week
        </a>
        <Button size="sm" disabled={loading} onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <h1 className={styles.printTitle}>{title}</h1>
      {host.provenance === "sample" ? <p className={styles.meta}>Sample sections: times and instructors are made up. Check myUNT before you register.</p> : null}
      {host.courses.length === 0 ? (
        <p className={styles.hint}>No classes yet. Add some in Week, then print.</p>
      ) : (
        <>
          <WeekGrid
            label={title}
            events={events}
            placements={placeEvents(events)}
            walks={walksOf(events, host.walk)}
            hueOf={(code) => hues.get(code) ?? 1}
            kept={new Set()}
            selectedCourse={null}
            outlines={[]}
            ghost={[]}
            busy={[]}
            motion={{ key: "print", instant: true }}
            interactive={false}
            phone={false}
            onSelect={noop}
            onPick={() => false}
            onDrag={noop}
            footer={null}
          />
          <table className={styles.printTable}>
            <thead>
              <tr>
                <th scope="col">Course</th>
                <th scope="col">Section</th>
                <th scope="col">When</th>
                <th scope="col">Where</th>
                <th scope="col">Instructor</th>
                <th scope="col">Class numbers</th>
              </tr>
            </thead>
            <tbody>
              {host.courses.map((course) => (
                <tr key={course.code}>
                  <th scope="row">
                    <b className={styles.code}>{course.code}</b> {course.title}
                  </th>
                  <td>{course.section ? `§${sectionLabel(course.section)}` : ""}</td>
                  <td>{course.section ? patternOf(course.section) : (course.note ?? "Not placed")}</td>
                  <td>{course.section ? [...new Set(course.section.meetings.map((m) => m.room))].join(" and ") : ""}</td>
                  <td>{course.section?.instructor.display ?? ""}</td>
                  <td>{course.section && course.section.term !== null ? course.section.classNumbers.join(" ") : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
