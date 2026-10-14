"use client";

import { activeCampus, campusById } from "@/lib/campus/config";
import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { usePlanner } from "@/components/planner-provider";
import { provenanceSource, provenanceText, summarizeProvenance } from "@/components/sections-provenance";
import { DaySummary, DaySwitcher, EmptyDay, OtherCampusEmpty, Timeline } from "@/components/map/map-itinerary";
import { MapSheet, type SheetDetent } from "@/components/map/map-sheet";
import type { CameraInsets } from "@/components/map/map-canvas";
import type { MapSelection } from "@/components/map/selection";
import { useItinerary } from "@/components/map/use-itinerary";
import { usePageState } from "@/components/shell/shell-context";
import { classDays, weekDays, type ClassDay } from "@/lib/types";
import "@/components/map/map.css";
import { getPlanningTermCourseCodes } from "@/lib/planner";

const MapCanvas = dynamic(() => import("@/components/map/map-canvas").then((module) => module.MapCanvas), {
  ssr: false,
  loading: () => <div className="mv-canvas mv-canvas--loading" aria-hidden="true" />,
});

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Desktop panel geometry, mirrored in map.css (--mv-panel-w, --mv-inset). */
const PANEL_WIDTH = 368;
const INSET = 16;
const CONTROLS_WIDTH = 36;
/** The map credits line above the phone sheet, about two lines of 11px text. */
const PHONE_CREDITS_HEIGHT = 40;

/** Bring a row into view inside its own scroll container, without scrolling the page. */
function revealRow(container: HTMLElement | null, row: HTMLElement | undefined, align: "nearest" | "start", smooth: boolean) {
  if (!container || !row) return;
  const top = row.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  const bottom = top + row.offsetHeight;
  let target: number | null = null;
  if (align === "start") target = top - 8;
  else if (top < container.scrollTop) target = top - 8;
  else if (bottom > container.scrollTop + container.clientHeight) target = bottom - container.clientHeight + 8;
  if (target !== null) container.scrollTo({ top: Math.max(0, target), behavior: smooth ? "smooth" : "auto" });
}

export function MapClient({ campusId = activeCampus.id }: { campusId?: string }) {
  const campus = campusById(campusId);
  const { plannerState, routeStops, setActiveDay, hydrated, sectionPlan } = usePlanner();
  const sectionsLoading = sectionPlan.courses.some((course) => course.state === "loading");
  const provenance = summarizeProvenance(
    sectionPlan.courses.flatMap((course) => (course.result ? [course.result] : [])),
    sectionPlan.courses.some((course) => course.section?.term === null),
  );
  const source = provenance ? { text: provenanceText(provenance, true), title: provenanceSource(provenance) } : null;
  const activeDay = plannerState.activeDay;
  const stops = useMemo(() => campus.id === activeCampus.id ? routeStops[activeDay] ?? [] : [], [activeDay, routeStops, campus.id]);
  const itinerary = useItinerary(stops);

  const isPhone = useMediaQuery("(max-width: 759px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const [selection, setSelection] = useState<MapSelection>(null);
  // Kept while the student visits other lenses: each tab keeps its own sheet.
  const [detent, setDetent] = usePageState<SheetDetent>("sheet-detent", "half");
  const [sheetVisible, setSheetVisible] = useState(0);
  const [areaHeight, setAreaHeight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());

  const counts = useMemo(
    () => Object.fromEntries(classDays.map((day) => [day, (campus.id === activeCampus.id ? routeStops[day] ?? [] : []).length])) as Record<ClassDay, number>,
    [routeStops, campus.id],
  );
  const days = classDays.filter((day) => (weekDays as readonly ClassDay[]).includes(day) || counts[day] > 0 || day === activeDay);
  const firstDayWithClasses = days.find((day) => counts[day] > 0);

  // Open on a day that has classes, unless the student picked one. While
  // sections load, an empty day may only be empty for now.
  const pickedDay = useRef(false);
  useEffect(() => {
    if (hydrated && !sectionsLoading && !pickedDay.current && counts[activeDay] === 0 && firstDayWithClasses) {
      setActiveDay(firstDayWithClasses);
    }
  }, [activeDay, counts, firstDayWithClasses, hydrated, sectionsLoading, setActiveDay]);

  const changeDay = useCallback(
    (day: ClassDay) => {
      pickedDay.current = true;
      setSelection(null);
      setActiveDay(day);
    },
    [setActiveDay],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => setAreaHeight(root.clientHeight));
    observer.observe(root);
    setAreaHeight(root.clientHeight);
    return () => observer.disconnect();
  }, []);

  const select = useCallback(
    (next: MapSelection) => {
      setSelection(next);
      // At peek the chosen row is hidden; at full the map is. Half shows both.
      if (next && isPhone && detent !== "half") setDetent("half");
    },
    [detent, isPhone, setDetent],
  );

  // The matching row comes into view whichever side the selection came from.
  useEffect(() => {
    if (!selection) return;
    revealRow(
      scrollRef.current,
      rows.current.get(selection.key),
      isPhone ? "start" : "nearest",
      !reducedMotion && !selection.instant,
    );
  }, [isPhone, reducedMotion, selection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const registerRow = useCallback((key: string, element: HTMLElement | null) => {
    if (element) rows.current.set(key, element);
    else rows.current.delete(key);
  }, []);

  // Phone: the sheet's settled height, plus room for the credits line above it.
  const insets: CameraInsets = isPhone
    ? { top: 24, right: 12, bottom: sheetVisible + PHONE_CREDITS_HEIGHT, left: 12 }
    : { top: INSET, right: INSET * 2 + CONTROLS_WIDTH, bottom: INSET, left: PANEL_WIDTH + INSET * 2 };

  const header = (
    <div className="mv-panel__header">
      <DaySwitcher days={days} activeDay={activeDay} counts={counts} onChange={changeDay} />
      <DaySummary day={activeDay} itinerary={itinerary} source={source} />
    </div>
  );

  const body = !hydrated ? (
    <div className="mv-empty" aria-busy="true">
      <p>Loading your plan…</p>
    </div>
  ) : campus.id !== activeCampus.id ? (
    <OtherCampusEmpty campusName={campus.shortName} homeName={activeCampus.shortName} />
  ) : itinerary.stops.length === 0 ? (
    <EmptyDay day={activeDay} firstDayWithClasses={firstDayWithClasses} onPickDay={changeDay} />
  ) : (
    <>
      <Timeline itinerary={itinerary} selection={selection} onSelect={select} registerRow={registerRow} />
      <div className="mv-panel__footer">
        <button type="button" className="mv-button" onClick={() => window.print()}>
          Print itinerary
        </button>
      </div>
    </>
  );

  // The root is the shell's full-bleed body (data-shell-body): the app shell
  // sizes it to exactly the space between the top bar and the phone tabs and
  // stops the page scrolling, so the map needs no header measurement.
  return (
    <div
      ref={rootRef}
      className="mv-root"
      data-shell-body="full-bleed"
      data-layout={isPhone ? "phone" : "desktop"}
      style={{ "--mv-sheet-visible": `${isPhone ? sheetVisible : 0}px` } as CSSProperties}
    >
      <h1 className="mv-visually-hidden">Campus map</h1>
      <MapCanvas
        key={campus.id}
        campus={campus}
        itinerary={itinerary}
        courseOrder={getPlanningTermCourseCodes(plannerState)}
        selection={selection}
        onSelect={select}
        insets={insets}
        reducedMotion={reducedMotion}
        // At full the sheet covers the map: no useful framing is possible.
        frozen={isPhone && detent === "full"}
      />
      {isPhone ? (
        areaHeight > 0 ? (
          <MapSheet
            detent={detent}
            onDetentChange={setDetent}
            onVisibleHeightChange={setSheetVisible}
            reducedMotion={reducedMotion}
            areaHeight={areaHeight}
            header={header}
            bodyRef={scrollRef}
          >
            {body}
          </MapSheet>
        ) : null
      ) : (
        <aside className="mv-panel" aria-label="Itinerary">
          {header}
          <div ref={scrollRef} className="mv-panel__body" data-lens-scroll="">
            {body}
          </div>
        </aside>
      )}
    </div>
  );
}
