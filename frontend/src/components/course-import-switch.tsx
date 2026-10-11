"use client";

import { useState } from "react";
import { CourseImportPanel } from "@/components/course-import-panel";
import { TranscriptImportClient } from "@/components/transcript-import-client";
import { NavShell } from "@/components/nav-shell";
import { Button } from "@/components/ui/Button";
import { usePlanner, useToast } from "@/components/planner-provider";

type ImportMode = "text" | "transcript";

/**
 * Hosts the reachable text-import flow alongside the PDF transcript flow.
 *
 * The transcript client renders its own NavShell, so the two modes are
 * switched rather than nested — exactly one shell renders at a time. The
 * text panel reuses the planner provider's public actions; no second store.
 */
export function CourseImportSwitch({ initialMode = "text" }: { initialMode?: ImportMode }) {
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const { hydrated, plannerState, setCourseStatus } = usePlanner();
  const { toast } = useToast();

  if (mode === "transcript") {
    return <TranscriptImportClient />;
  }

  return (
    <NavShell
      step={0}
      back={{ href: "/courses", label: "Courses" }}
      next={{ href: "/schedule", label: "Optimize schedule" }}
      stickyFooter={false}
    >
      <div
        style={{
          maxWidth: 860,
          margin: "0 auto",
          padding: "1.5rem 1.25rem",
          display: "grid",
          gap: "1rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => setMode("transcript")}>
            Use the PDF transcript importer instead
          </Button>
        </div>
        <CourseImportPanel
          courseStatuses={plannerState.courseStatuses}
          setCourseStatus={setCourseStatus}
          toast={toast}
          plannerReady={hydrated}
        />
      </div>
    </NavShell>
  );
}
