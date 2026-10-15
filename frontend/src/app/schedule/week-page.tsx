"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { PlannerPersistencePanel } from "@/components/planner-persistence-panel";
import { usePlanner } from "@/components/planner-provider";
import { ScheduleBuilder, type SearchRequest } from "@/components/schedule-builder/ScheduleBuilder";
import { decodeShare, SHARE_PARAM } from "@/components/schedule-builder/share";
import { VsbBar, type VsbTerm } from "@/components/schedule-builder/VsbBar";
import { SCHEDULE_NAME } from "@/components/shell/plan-status";
import { useShellSearch } from "@/components/shell/shell-context";
import { toast, useIsClient } from "@/components/ui/Toast";
import { PHONE_QUERY, useMediaQuery } from "@/components/ui/use-media-query";
import { brandFor, type HostId } from "@/lib/brand";
import { supportedTerms } from "@/lib/sections";
import { useUntangleHost } from "./untangle-host";

/** The standalone builder's term control: what vsb publishes, around the term it has. */
const VSB_TERMS: readonly Omit<VsbTerm, "available">[] = [
  { id: "fall-2026", label: "Fall 2026" },
  { id: "spring-2027", label: "Spring 2027" },
  { id: "summer-2027", label: "Summer 2027" },
];

/** Drops query parameters the page has acted on, so a reload doesn't act again. */
function forget(...names: string[]) {
  const url = new URL(window.location.href);
  names.forEach((name) => url.searchParams.delete(name));
  window.history.replaceState(window.history.state, "", url);
}

export function WeekPage({ hostId, query, week }: { hostId: HostId; query: string | null; week: string | null }) {
  const brand = brandFor(hostId);
  const host = useUntangleHost(brand);
  const { sectionPlan, saveState, tookNewerVersion, storeNotices } = usePlanner();
  // The save bar shows only when saving needs the student (a conflict with another tab, a failure);
  // it stays mounted for its status region and the conflict dialog.
  const saveCalm = ["saved", "saving", "pending"].includes(saveState.status) && !tookNewerVersion && storeNotices.length === 0;
  const phone = useMediaQuery(PHONE_QUERY);
  const isClient = useIsClient();
  // ?q= arrives from the top bar's class-number result on another lens.
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(query ? { nonce: 1, query } : null);
  const [shared, setShared] = useState(() => (week ? decodeShare(week) : null));

  const openSearch = useCallback(() => setSearchRequest((request) => ({ nonce: (request?.nonce ?? 0) + 1, query: "" })), []);
  useShellSearch(useMemo(() => ({ search: () => [], onSelect: () => undefined, open: openSearch }), [openSearch]));

  useEffect(() => {
    if (query) forget("q");
  }, [query]);

  const real = sectionPlan.courses.find((course) => course.result?.provenance.kind === "real")?.result?.provenance;
  const freshness = real?.kind === "real" ? real.updatedAt : null;

  return (
    <div className="shell-content" data-shell-chrome={brand.id === "vsb" ? "own" : undefined}>
      {brand.id === "vsb" && isClient
        ? createPortal(
            <VsbBar
              terms={VSB_TERMS.map((term) => ({ ...term, available: supportedTerms.some((s) => s.id === term.id) }))}
              term={host.term.id}
              updatedAt={freshness}
              scheduleName={SCHEDULE_NAME}
              phone={phone}
              onSearch={openSearch}
              onClear={() => {
                host.edits.clear();
                toast({ message: `Cleared ${SCHEDULE_NAME}`, action: { label: "Undo", onClick: host.edits.undo } });
              }}
            />,
            document.body,
          )
        : null}
      <div className={saveCalm ? "sr-only-v2" : undefined}>
        <PlannerPersistencePanel />
      </div>
      <h1 className="sr-only-v2">{brand.id === "vsb" ? brand.name : `${host.term.label} week`}</h1>
      <ScheduleBuilder
        host={host}
        scheduleName={SCHEDULE_NAME}
        searchRequest={searchRequest}
        shared={shared}
        onSharedSeen={() => {
          setShared(null);
          forget(SHARE_PARAM);
        }}
      />
    </div>
  );
}
