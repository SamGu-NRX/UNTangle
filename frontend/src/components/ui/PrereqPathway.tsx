"use client";

import Link from "next/link";
import { useMemo } from "react";
import { courses, prerequisiteEdges } from "@/lib/seed-data";
import { doesCourseSatisfyPrerequisite, isCourseLocked } from "@/lib/planner";
import { usePlanner } from "@/components/planner-provider";
import type { CourseStatus } from "@/lib/types";

type NodeStatus = "completed" | "inProgress" | "available" | "locked";

function detailHref(code: string) {
  const parts = code.split(/\s+/);
  if (parts.length < 2) return null;
  return `/courses/${parts[0]}/${parts[1]}`;
}

function statusFor(
  code: string,
  courseStatuses: Record<string, CourseStatus>,
  transcriptRecords: Parameters<typeof doesCourseSatisfyPrerequisite>[2],
  locked: boolean,
): NodeStatus {
  const s = courseStatuses[code];
  if (s === "completed" && doesCourseSatisfyPrerequisite(code, courseStatuses, transcriptRecords)) {
    return "completed";
  }
  if (s === "inProgress") return "inProgress";
  if (locked) return "locked";
  return "available";
}

function statusGlyph(s: NodeStatus) {
  if (s === "completed") return "✓";
  if (s === "inProgress") return "◐";
  if (s === "locked") return "🔒";
  return "○";
}

type PathNode = {
  code: string;
  title: string;
  status: NodeStatus;
  depth: number;
  isLast: boolean;
};

export function PrereqPathway({ courseCode }: { courseCode: string }) {
  const { plannerState } = usePlanner();

  const nodes = useMemo(() => {
    const out: PathNode[] = [];
    const seen = new Set<string>();
    const titleByCode = new Map(courses.map((c) => [c.code, c.title]));

    function locked(code: string) {
      return isCourseLocked(plannerState, code);
    }

    function visit(code: string, depth: number, isLast: boolean) {
      if (seen.has(code)) return;
      seen.add(code);
      const status = statusFor(
        code,
        plannerState.courseStatuses,
        plannerState.transcriptRecords,
        locked(code),
      );
      out.push({
        code,
        title: titleByCode.get(code) ?? "",
        status,
        depth,
        isLast,
      });
      if (depth >= 3) return;
      const directs = prerequisiteEdges
        .filter((edge) => edge.courseCode === code)
        .map((edge) => edge.prerequisiteCode);
      directs.forEach((p, i) => visit(p, depth + 1, i === directs.length - 1));
    }

    visit(courseCode, 0, true);
    return out;
  }, [courseCode, plannerState]);

  if (nodes.length <= 1) {
    return (
      <div className="j-prereq__empty">
        No prerequisites — this course is open to anyone.
      </div>
    );
  }

  return (
    <div className="j-prereq" aria-label="Prerequisite pathway">
      {nodes.map((n, i) => {
        const href = detailHref(n.code);
        const isRoot = n.depth === 0;
        const indents = Array.from({ length: n.depth }, (_, d) => {
          const isLastSegment = d === n.depth - 1;
          return (
            <span
              key={d}
              className="j-prereq__indent"
              data-leaf={!isLastSegment ? "true" : "false"}
              data-last={isLastSegment && n.isLast ? "true" : "false"}
              aria-hidden="true"
            />
          );
        });
        const inner = (
          <>
            {indents}
            <span className="j-prereq__dot" data-status={n.status}>
              {statusGlyph(n.status)}
            </span>
            <span className="j-prereq__code">{n.code}</span>
            {n.title ? <span className="j-prereq__title">{n.title}</span> : null}
          </>
        );
        const key = `${n.code}-${i}`;
        if (href && !isRoot) {
          return (
            <Link
              key={key}
              href={href}
              className="j-prereq__node"
              data-clickable="true"
              data-status={n.status}
            >
              {inner}
            </Link>
          );
        }
        return (
          <div key={key} className="j-prereq__node" data-status={n.status}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
