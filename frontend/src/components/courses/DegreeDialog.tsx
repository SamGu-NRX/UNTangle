"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Check } from "@/components/ui/icons";
import { SearchField } from "@/components/ui/SearchField";
import { majors } from "@/lib/seed-data";
import type { MajorId } from "@/lib/types";
import styles from "./courses.module.css";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  major: MajorId | null;
  onChoose: (id: MajorId) => void;
  /** Where the statuses come from, in one line. */
  source: "transcript" | "sample" | "none";
  onImport: () => void;
  onSample: () => void;
  /** The major's core list against the student's record; null without a major. */
  core: { done: number; covered: number; total: number } | null;
};

const SOURCE_TEXT = {
  transcript: "From your transcript",
  sample: "From a made-up sample transcript",
  none: "No transcript yet",
} as const;

/**
 * The degree behind the page (rule 8): the major as a search list, not a
 * dropdown, how far the student is through its core list, and where the
 * statuses came from with a way to import again.
 * There is no catalog-year control: the core lists carry no catalog year.
 */
export function DegreeDialog({ open, onOpenChange, major, onChoose, source, onImport, onSample, core }: Props) {
  const [query, setQuery] = useState("");
  const shown = majors.filter((entry) => entry.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
      title="Your degree"
      width={460}
    >
      <SearchField
        label="Search majors"
        placeholder="Search majors"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery("")}
        className={styles.majorSearch}
      />
      <div className={styles.majorList} role="group" aria-label="Majors">
        {shown.length === 0 ? (
          <p className={styles.majorEmpty}>No major matches &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          shown.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={styles.majorRow}
              aria-pressed={entry.id === major}
              onClick={() => {
                onChoose(entry.id);
                setQuery("");
                onOpenChange(false);
              }}
            >
              {entry.name}
              {entry.id === major ? <Check size={18} /> : null}
            </button>
          ))
        )}
      </div>
      {core ? (
        <p className={styles.majorCore}>
          {core.done} of {core.total} core courses done{core.covered > 0 ? `, ${core.covered} more covered by later courses` : ""}
        </p>
      ) : null}
      <div className={styles.majorSource}>
        <span>{SOURCE_TEXT[source]}</span>
        {source === "none" ? (
          <Button variant="quiet" size="sm" onClick={onSample}>
            Try a sample
          </Button>
        ) : null}
        <Button variant="quiet" size="sm" onClick={onImport}>
          {source === "transcript" ? "Import again" : "Import transcript"}
        </Button>
      </div>
    </Dialog>
  );
}
