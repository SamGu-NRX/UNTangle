"use client";

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
import { provenanceSource, summarizeProvenance } from "@/components/sections-provenance";
import { usePageState } from "@/components/shell/shell-context";
import { PHONE_QUERY, useMediaQuery } from "@/components/ui/use-media-query";
import { activeCampus, campusById } from "@/lib/campus/config";
import { dayHero, type HeroClass } from "@/lib/leave-by";
import { toMinutes, type StartPlace } from "@/lib/map-itinerary";
import { classDays, type ClassDay } from "@/lib/types";
import { DayHero, DayItinerary, DayStepper, StartPicker, type NextClass } from "@/components/map/day-panel";
import { classDayOf, isoDateOf, meetsOn, minuteOf, nextClassDay, nextClassFrom, stepperDays } from "@/components/map/day-steps";
import type { CameraPadding, DayFrame } from "@/components/map/map-canvas";
import { MapSheet, type SheetDetent } from "@/components/map/map-sheet";
import type { MapSelection } from "@/components/map/selection";
import type { StartPlaceOption } from "@/components/map/start-places";
import { setStartingPoint, useStartingPoint } from "@/components/map/starting-point";
import { useItinerary } from "@/components/map/use-itinerary";
import "@/components/map/map.css";

const MapCanvas = dynamic(() => import("@/components/map/map-canvas").then((module) => module.MapCanvas), {
  ssr: false,
  loading: () => <div className="mv-canvas mv-canvas--loading" aria-hidden="true" />,
});

/* ---------- the clock ---------- */

const clockListeners = new Set<() => void>();
let clockMinute = 0;
let clockTimer: ReturnType<typeof setTimeout> | undefined;

function tick() {
  clockMinute = Math.floor(Date.now() / 60_000);
  clockListeners.forEach((listener) => listener());
  clockTimer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
}

/** The current minute, re-rendering when it turns; null on the server. */
function useClock(): Date | null {
  const minute = useSyncExternalStore(
    (onChange) => {
      clockListeners.add(onChange);
      if (clockListeners.size === 1) tick();
      return () => {
        clockListeners.delete(onChange);
        if (clockListeners.size === 0) clearTimeout(clockTimer);
      };
    },
    () => clockMinute || Math.floor(Date.now() / 60_000),
    () => null,
  );
  return minute === null ? null : new Date(minute * 60_000);
}

/* ---------- layout ---------- */

/**
 * Clearances around the parts of the screen the camera must not aim under
 * (apple-maps-web/camera.md). Starting values from that spec, not measured
 * on devices.
 */
const CLEAR = {
  /** Beyond the measured panel or sheet edge. */
  edge: 28,
  phoneEdge: 20,
  /** Right edge: the map controls column. */
  controls: 88,
  phoneControls: 72,
  /** Bottom on desktop, above the attribution row (which the map measures and adds). */
  attribution: 32,
  top: 44,
  phoneSide: 30,
};
/** A stop pin stands this tall above its building's point (map.css .mv-pin), px. */
const PIN_HEIGHT = 40;

/**
 * Bring a row into view inside its own scroll container, without scrolling
 * the page. `visible` is how much of the container shows: less than its
 * height when the phone sheet sits at half.
 */
function revealRow(container: HTMLElement | null, row: HTMLElement | undefined, visible: number, smooth: boolean) {
  if (!container || !row) return;
  const top = row.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  // The row and the detail expanded under it.
  const bottom = top + (row.parentElement?.offsetHeight ?? row.offsetHeight);
  let target: number | null = null;
  if (top < container.scrollTop) target = top - 8;
  else if (bottom > container.scrollTop + visible) target = Math.min(top - 8, bottom - visible + 8);
  if (target !== null) container.scrollTo({ top: Math.max(0, target), behavior: smooth ? "smooth" : "auto" });
}

export function DayView({ campusId, places }: { campusId: string; places: readonly StartPlaceOption[] }) {
  const campus = campusById(campusId);
  const onCampus = campus.id === activeCampus.id;
  const { routeStops, hydrated, sectionPlan } = usePlanner();
  const ready = hydrated && !sectionPlan.courses.some((course) => course.state === "loading");
  const provenance = summarizeProvenance(
    sectionPlan.courses.flatMap((course) => (course.result ? [course.result] : [])),
    sectionPlan.courses.some((course) => course.section?.term === null),
  );

  const clock = useClock();
  const today = clock ? classDayOf(clock) : null;
  // Today comes first; the stepper reaches the rest. Kept while the student visits other lenses.
  const [pickedDay, setPickedDay] = usePageState<ClassDay | null>("day", null);
  const day = pickedDay ?? today ?? "Mon";
  const isToday = day === today;
  const now = isToday && clock ? minuteOf(clock) : null;

  const counts = useMemo(
    () => Object.fromEntries(classDays.map((d) => [d, onCampus ? (routeStops[d]?.length ?? 0) : 0])) as Record<ClassDay, number>,
    [routeStops, onCampus],
  );
  const days = stepperDays(counts, today ?? day);
  // Today counts only the meetings whose session runs today; another day shows the weekday's plan.
  const todayDate = isToday && clock ? isoDateOf(clock) : null;
  const stops = useMemo(() => {
    const all = onCampus ? (routeStops[day] ?? []) : [];
    return todayDate ? all.filter((stop) => meetsOn(stop, todayDate)) : all;
  }, [day, routeStops, onCampus, todayDate]);
  const start = useStartingPoint();
  const itinerary = useItinerary(stops, start);

  const hero = dayHero(
    itinerary.stops.map((entry, index): HeroClass => ({
      start: toMinutes(entry.stop.start),
      end: toMinutes(entry.stop.end),
      walkMin: (index === 0 ? itinerary.start?.leg : itinerary.legs[index - 1])?.walkMinutes ?? null,
    })),
    now,
  );
  const following = nextClassDay(counts, day);
  const next: NextClass = !onCampus
    ? null
    : isToday && clock
      ? nextClassFrom(routeStops, clock)
      : following && { ...following, stop: routeStops[following.day][0] };

  const isPhone = useMediaQuery(PHONE_QUERY);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const [selection, setSelection] = useState<MapSelection>(null);
  const [frame, setFrame] = useState<DayFrame>({ day, instant: true });
  // Each lens keeps its own sheet while the student visits the others.
  const [detent, setDetentState] = usePageState<SheetDetent>("sheet-detent", "half");
  // Whether the sheet's next move came from the keyboard, which moves it without animating.
  const [sheetInstant, setSheetInstant] = useState(false);
  const setDetent = useCallback(
    (next: SheetDetent, instant = false) => {
      setSheetInstant(instant);
      setDetentState(next);
    },
    [setDetentState],
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const [area, setArea] = useState({ height: 0, panelRight: 0, topBottom: 0 });
  const [sheetVisible, setSheetVisible] = useState(0);
  // The compact attribution's usual height until the map measures it.
  const [creditsHeight, setCreditsHeight] = useState(28);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      setArea({
        height: root.clientHeight,
        panelRight: panelRef.current ? panelRef.current.getBoundingClientRect().right - box.left : 0,
        topBottom: topRef.current ? topRef.current.getBoundingClientRect().bottom - box.top : 0,
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (panelRef.current) observer.observe(panelRef.current);
    if (topRef.current) observer.observe(topRef.current);
    measure();
    return () => observer.disconnect();
  }, [isPhone]);

  const changeDay = useCallback(
    (next: ClassDay, instant: boolean) => {
      setSelection(null);
      setPickedDay(next);
      setFrame({ day: next, instant });
    },
    [setPickedDay],
  );

  const select = useCallback(
    (next: MapSelection) => {
      // At peek the chosen row is hidden; at full the map is. Half shows both,
      // and the camera waits for the sheet to get there.
      const moveSheet = next !== null && isPhone && detent !== "half";
      if (moveSheet) setDetent("half", next.instant);
      setSelection(next && moveSheet && !next.instant ? { ...next, afterSheet: true } : next);
    },
    [detent, isPhone, setDetent],
  );

  // The matching row comes into view whichever side the selection came from,
  // within the part of the list the sheet shows once it settles.
  useEffect(() => {
    const body = scrollRef.current;
    if (!selection || !body) return;
    const visible = isPhone ? Math.min(body.clientHeight, sheetVisible - body.offsetTop) : body.clientHeight;
    // On the phone the list jumps: the sheet's own move is the motion, and its
    // body stops scrolling at half, which would cut a smooth scroll short.
    revealRow(body, rows.current.get(selection.key), visible, !isPhone && !reducedMotion && !selection.instant);
  }, [isPhone, reducedMotion, selection, sheetVisible]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setSelection(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const registerRow = useCallback((key: string, element: HTMLElement | null) => {
    if (element) rows.current.set(key, element);
    else rows.current.delete(key);
  }, []);

  // At full the sheet stops below the stepper and the attribution, which stay visible at every detent.
  const phoneFull = Math.max(0, area.height - area.topBottom - 8 - Math.ceil(creditsHeight));
  const padding: CameraPadding = isPhone
    ? {
        // The camera aims at points; a pin rises above its point, under the stepper unless room is kept.
        top: area.topBottom + CLEAR.phoneEdge + PIN_HEIGHT,
        right: CLEAR.phoneControls,
        bottom: sheetVisible + CLEAR.phoneEdge,
        left: CLEAR.phoneSide,
      }
    : { top: CLEAR.top, right: CLEAR.controls, bottom: CLEAR.attribution, left: area.panelRight + CLEAR.edge };

  const openPicker = () => setPickerOpen(true);
  // Picking a starting point replaces the control that opened the search, so
  // focus goes to whatever now starts the day.
  const pickStart = (place: StartPlace | null) => {
    setStartingPoint(place);
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(".mv-itin__start button")?.focus());
  };
  const stepper = <DayStepper days={days} day={day} today={today} onStep={changeDay} />;
  const heroView = !ready ? (
    <div className="mv-hero" aria-busy="true">
      <p className="mv-hero__label">Loading your classes</p>
    </div>
  ) : (
    <DayHero
      hero={hero}
      itinerary={itinerary}
      day={day}
      isToday={isToday}
      next={next}
      hasClasses={counts.Mon + counts.Tue + counts.Wed + counts.Thu + counts.Fri + counts.Sat + counts.Sun > 0}
    />
  );
  const body =
    ready && itinerary.stops.length > 0 ? (
      <>
        <DayItinerary
          itinerary={itinerary}
          selection={selection}
          onSelect={select}
          now={now}
          onChangeStart={openPicker}
          registerRow={registerRow}
        />
      </>
    ) : null;
  // Said once, wherever the day's advice comes from sample sections.
  const sample =
    ready && provenance?.kind === "sample" ? (
      <p className="mv-source" title={provenanceSource(provenance)}>
        Sample sections
      </p>
    ) : null;

  // The root is the shell's full-bleed body: the app shell sizes it to the
  // space between the top bar and the phone tabs and stops the page scrolling.
  return (
    <div
      ref={rootRef}
      className="mv-root"
      data-shell-body="full-bleed"
      data-layout={isPhone ? "phone" : "desktop"}
      data-detent={isPhone ? detent : undefined}
      style={{ "--mv-sheet-visible": `${isPhone ? sheetVisible : 0}px` } as CSSProperties}
    >
      <h1 className="mv-visually-hidden">Day</h1>
      {isPhone ? (
        <>
          <div ref={topRef} className="mv-top">
            {stepper}
          </div>
          {area.height > 0 ? (
            <MapSheet
              detent={detent}
              onDetentChange={setDetent}
              instant={sheetInstant}
              onVisibleHeightChange={setSheetVisible}
              reducedMotion={reducedMotion}
              areaHeight={area.height}
              fullHeight={phoneFull}
              header={heroView}
              bodyRef={scrollRef}
            >
              {body}
              {sample}
            </MapSheet>
          ) : null}
        </>
      ) : (
        <aside ref={panelRef} className="mv-panel" aria-label="Your day">
          <div ref={scrollRef} className="mv-panel__body" data-lens-scroll="">
            {stepper}
            {heroView}
            {body}
            {sample}
          </div>
        </aside>
      )}
      {/* After the day in the DOM, so Tab reaches the answer before the map; z-index keeps it underneath. */}
      <MapCanvas
        key={campus.id}
        campus={campus}
        itinerary={itinerary}
        selection={selection}
        onSelect={select}
        padding={padding}
        frame={frame}
        reducedMotion={reducedMotion}
        // At full the sheet covers the map: no useful framing is possible.
        frozen={isPhone && detent === "full"}
        onCreditsHeight={setCreditsHeight}
      />
      <StartPicker open={pickerOpen} onOpenChange={setPickerOpen} places={places} current={start} onPick={pickStart} />
    </div>
  );
}
