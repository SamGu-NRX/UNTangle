"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { usePlanner, useToast } from "@/components/planner-provider";
import { myUntClassNumbers } from "@/lib/planner";
import { buildPlanIcs, checkTermDates, icsFileName, needsTermDates, type TermDates } from "@/lib/planner-ics";

function download(content: string, fileName: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export the week: a print view, the class numbers to enter in myUNT, and an
 * .ics calendar file. Real meetings carry their own dates; only sample
 * meetings need the term's first and last day, which the user types, since
 * UNTangle does not know UNT's academic calendar and never guesses it.
 */
export function PlannerExportPanel() {
  const { scheduleEvents, sectionPlan } = usePlanner();
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<{ field: "start" | "end"; message: string } | null>(null);
  const startId = useId();
  const endId = useId();
  const errorId = useId();
  const hintId = useId();

  const exportIcs = (term: TermDates | null) => {
    const result = buildPlanIcs(scheduleEvents, term);
    const dates = scheduleEvents.flatMap((event) => (event.dates ? [event.dates] : []));
    const span = term ?? {
      start: dates.map((range) => range.start).sort()[0],
      end: dates.map((range) => range.end).sort().at(-1)!,
    };
    download(result.ics, icsFileName(span), "text/calendar;charset=utf-8");
    const skippedNote =
      result.skipped.length > 0
        ? `; ${result.skipped.length} meeting${result.skipped.length === 1 ? "" : "s"} fall outside their dates`
        : "";
    toast(`Downloaded ${result.eventCount} weekly class${result.eventCount === 1 ? "" : "es"}${skippedNote}`);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const checked = checkTermDates({ start, end });
    if (!checked.ok) {
      setError({ field: checked.field, message: checked.message });
      return;
    }
    exportIcs(checked);
    setOpen(false);
    setError(null);
  };

  const classNumbers = myUntClassNumbers(sectionPlan);
  const copyClassNumbers = async () => {
    try {
      await navigator.clipboard.writeText(classNumbers.text);
      const missingNote = classNumbers.missing.length > 0 ? `; no real section yet for ${classNumbers.missing.join(", ")}` : "";
      toast(`Copied ${classNumbers.count} class number${classNumbers.count === 1 ? "" : "s"}${missingNote}`);
    } catch {
      toast("Your browser blocked copying. The numbers are listed under each course in Courses.");
    }
  };

  const empty = scheduleEvents.length === 0;

  return (
    <section className="surface-card" style={{ padding: "0.95rem 1rem" }} aria-labelledby="export-heading">
      <p id="export-heading" className="editorial-label" style={{ marginBottom: 10 }}>
        Export
      </p>
      <div style={{ display: "grid", gap: 6 }}>
        <button type="button" className="btn-secondary" onClick={() => router.push("/schedule/print")}>
          Print schedule
        </button>
        <button type="button" className="btn-secondary" onClick={copyClassNumbers} disabled={classNumbers.count === 0}>
          Copy class numbers for myUNT
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => (needsTermDates(scheduleEvents) ? setOpen(true) : exportIcs(null))}
          disabled={empty}
        >
          Download .ics
        </button>
        {empty ? (
          <span style={{ fontSize: "0.78rem", color: "var(--copy)" }}>Add a class to export a calendar.</span>
        ) : null}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Download calendar" maxWidth={460}>
        <form onSubmit={submit} noValidate style={{ display: "grid", gap: "0.8rem" }}>
          <p id={hintId} style={{ margin: 0, fontSize: "0.88rem", color: "var(--copy)" }}>
            Sample sections have no term, so enter your term&rsquo;s first and last day of classes for them. UNTangle
            doesn&rsquo;t know UNT&rsquo;s academic calendar, so holidays and breaks are not removed.
          </p>
          <label htmlFor={startId} style={{ display: "grid", gap: 4, fontSize: "0.85rem", fontWeight: 600 }}>
            First day of classes
            <input
              id={startId}
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              aria-invalid={error?.field === "start" || undefined}
              aria-describedby={error?.field === "start" ? errorId : hintId}
              required
            />
          </label>
          <label htmlFor={endId} style={{ display: "grid", gap: 4, fontSize: "0.85rem", fontWeight: 600 }}>
            Last day of classes
            <input
              id={endId}
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              aria-invalid={error?.field === "end" || undefined}
              aria-describedby={error?.field === "end" ? errorId : hintId}
              required
            />
          </label>
          {error ? (
            <p id={errorId} role="alert" style={{ margin: 0, fontSize: "0.85rem", color: "var(--brand-700)" }}>
              {error.message}
            </p>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
            <button type="submit" className="btn-primary">
              Download calendar file
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
