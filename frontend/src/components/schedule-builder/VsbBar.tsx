"use client";

import { ChevronDown, Check } from "@/components/ui/icons";
import { Menu } from "@/components/ui/Menu";
import { SearchTrigger } from "@/components/ui/SearchField";
import { Segmented } from "@/components/ui/Segmented";
import styles from "./vsb.module.css";

export type VsbTerm = { id: string; label: string; available: boolean };

type Props = {
  terms: readonly VsbTerm[];
  term: string;
  /** When the section data was last published, or null for sample sections. */
  updatedAt: string | null;
  scheduleName: string;
  phone: boolean;
  onSearch: () => void;
  onClear: () => void;
};

const updated = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

/** "Updated Oct 4 at 2:02 PM", in campus time. */
export function freshnessLine(iso: string): string {
  const parts = Object.fromEntries(updated.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `Updated ${parts.month} ${parts.day} at ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

/**
 * The standalone UNT Schedule Builder's header (DESIGN.md §3.5): its own
 * name, a term control, search, when the data was updated, and the schedule
 * switcher. No account: schedules stay on the device. On a phone the term
 * control gives way to the switcher's menu, whose heading names the term.
 */
export function VsbBar({ terms, term, updatedAt, scheduleName, phone, onSearch, onClear }: Props) {
  const current = terms.find((t) => t.id === term);
  return (
    <header className={styles.bar} data-glass="">
      <span className={styles.brand}>
        <span className={styles.plate}>UNT</span>
        Schedule Builder
      </span>
      {phone ? null : (
        <>
          <Segmented
            label="Term"
            size="sm"
            className={styles.terms}
            value={term}
            // Only terms with published sections can be picked; the rest show what's coming.
            options={terms.map((t) => ({ value: t.id, label: t.label, disabled: !t.available }))}
            onValueChange={() => undefined}
          />
          <SearchTrigger className={styles.search} placeholder="Search courses or class numbers" onClick={onSearch} />
        </>
      )}
      <div className={styles.right}>
        {updatedAt && !phone ? <span className={styles.fresh}>{freshnessLine(updatedAt)}</span> : null}
        <Menu
          label="Schedules"
          align="end"
          items={[
            { kind: "label", id: "term", label: current?.label ?? "" },
            { id: "main", label: scheduleName, current: true, icon: <Check size={16} /> },
            { kind: "separator", id: "sep" },
            { id: "clear", label: `Clear ${scheduleName}`, destructive: true, onSelect: onClear },
          ]}
          trigger={(props) => (
            <button {...props} type="button" className={styles.switcher} aria-label={`Schedule: ${scheduleName}, saved on this device. Switch schedule`}>
              {scheduleName}
              <ChevronDown size={14} />
            </button>
          )}
        />
      </div>
    </header>
  );
}
