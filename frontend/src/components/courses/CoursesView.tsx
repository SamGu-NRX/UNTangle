"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { CONNECT_PATH, OPEN_CONNECT_EVENT } from "@/components/connect/open-connect";
import { usePlanner } from "@/components/planner-provider";
import { asksForMajor, LENS_HREF } from "@/components/shell/routes";
import { useShell, useShellSearch, type ShellSearchProvider } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/Button";
import { ContextPanel } from "@/components/ui/ContextPanel";
import { ChevronDown } from "@/components/ui/icons";
import { SearchTrigger } from "@/components/ui/SearchField";
import type { SearchItem } from "@/components/ui/SearchPalette";
import { toast } from "@/components/ui/Toast";
import { assignColors, type Hue } from "@/lib/course-colors";
import { getMajorById } from "@/lib/planner";
import { optionIdLabel, optionLabel } from "@/lib/planner-sections";
import type { CoursePlan, CourseStatus, MajorId } from "@/lib/types";
import styles from "./courses.module.css";
import { CourseNavigationContext, type CourseNavigation } from "./bits";
import { CourseDetail, type DetailActions } from "./CourseDetail";
import { CourseGroups } from "./CourseGroups";
import type { RowActions } from "./CourseRow";
import { DegreeDialog } from "./DegreeDialog";
import { undoBlocker } from "./model/auto";
import { buildCourseModel, type CourseModel, type CourseRowModel } from "./model/course-model";
import { checkDegree, withDegree } from "./model/degree";
import { buildGroups, OPEN_AT_START, ROWS_BEFORE_MORE, rowFact, type GroupKey } from "./model/groups";
import { autoTransaction, courseEdit, manualEdit, planAuto, snapshotOf, undoAutoTransaction, undoCourseEdit } from "./model/plan-edits";
import { creditProgress, creditsLabel, DEGREE_CREDITS } from "./model/progress";
import { sampleTranscript } from "./model/sample-transcript";
import { instructorIndex, searchCatalog } from "./model/search";
import { RequirementDetail, type LeftItem } from "./RequirementDetail";
import { AUTO_TIMELINE, fadeIn, flip, fly, measure, MOVE, reducedMotion, wait, type Rects } from "./reveal";
import { untProfile } from "./school";
import { TermTray } from "./TermTray";
import { LEFT_OPEN_AT_START, REQUIREMENT_PREFIX, WhatsLeft, type LeftGroupKey } from "./WhatsLeft";

const INSTRUCTOR_ITEM = "instructor:";
/** The groups that hold the student's own record, which show with or without a major. */
const OWN_RECORD: ReadonlySet<GroupKey> = new Set(["taking", "done"]);
const without = (list: readonly string[], id: string) => list.filter((value) => value !== id);
/** A row's other place: the same course in the tray or in its group. */
const otherPlace = (key: string) =>
  key.startsWith("row:") ? `tray:${key.slice(4)}` : key.startsWith("tray:") ? `row:${key.slice(5)}` : undefined;

/**
 * Opens the import page (/connect). The shell's ConnectHost claims the event
 * and navigates; with no shell mounted, go there through `navigate`.
 */
export function openConnect(navigate: (href: string) => void) {
  const claimed = !window.dispatchEvent(new Event(OPEN_CONNECT_EVENT, { cancelable: true }));
  if (!claimed) navigate(CONNECT_PATH);
}

/**
 * How an action plays (MOTION.md §1, §10): a pointer press animates; under
 * reduced motion new rows only fade; a keyboard press (or an action with no
 * press, such as search or a toast) changes at once.
 */
type Mode = "animate" | "fade" | "instant";
const modeOf = (event?: { detail: number }): Mode => (!event || event.detail === 0 ? "instant" : reducedMotion() ? "fade" : "animate");

/**
 * Motion waiting for the commit that carries its change: `ready` says
 * whether a committed model has it, and the layout effect then plays it
 * before that commit paints. A hand edit and Auto keep separate slots.
 */
type EditMotion = { first: Rects; duration: number; mode: Mode; focus: readonly string[]; ready: (model: CourseModel) => boolean };
type AutoMotion = { token: number; first: Rects; sources: Map<string, HTMLElement>; picks: string[]; mode: Mode; ready: (model: CourseModel) => boolean };

function searchMeta(row: CourseRowModel | undefined): string {
  if (!row) return "";
  const fact = rowFact(row);
  if (fact) return fact.text;
  return { available: "You can take this", planned: "Planned", taking: "Taking now" }[row.status as "available" | "planned" | "taking"] ?? "";
}

export function CoursesView({ initialCourseId = null, initialInstructor = null }: { initialCourseId?: string | null; initialInstructor?: string | null }) {
  const profile = useMemo(() => untProfile(), []);
  const term = profile.planningTerm;
  const { hydrated, plannerState, sectionPlan, sectionCatalog, catalogVersion, loadSections, setSelectedMajor, applyTranscriptRecords, updateCoursePlan, transact, planStamp } =
    usePlanner();
  const { openSearch } = useShell();
  const router = useRouter();
  const importTranscript = () => openConnect((href) => router.push(href));

  const { courseStatuses, transcriptRecords, coursePlan: storedPlan } = plannerState;
  const coursePlan: CoursePlan = storedPlan ?? { manualCredit: [], autoPlanned: [], lastAuto: null };
  const major = getMajorById(plannerState.selectedMajor) ?? null;
  // The prerequisite model says what a student can take; the degree audit says what the degree still needs.
  const { model, degree } = useMemo(
    () => {
      const snapshot = snapshotOf(plannerState);
      const base = buildCourseModel(profile, snapshot);
      const check = checkDegree(profile, snapshot, base, major);
      return { model: withDegree(base, check), degree: check };
    },
    // The model reads only these; the rest of the plan (sections, the map's day) changes often.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, courseStatuses, transcriptRecords, storedPlan, major],
  );
  const audited = degree.kind === "audited" ? degree : null;
  // Every department's courses, one step away; by default the groups list the degree's.
  const [wide, setWide] = useState(false);
  // Without a major the whole catalog is in scope, and hundreds of rules read as warnings; only the student's own record shows.
  const groups = useMemo(
    () => buildGroups(model, major, wide, audited && { needed: audited.needed, neededByMajor: audited.neededByMajor }).filter((group) => major || OWN_RECORD.has(group.key)),
    [model, major, wide, audited],
  );
  const hasDepartment = Boolean(major && major.department !== "—");
  const trayRows = useMemo(() => [...model.rows.values()].filter((row) => row.inPlan).sort((a, b) => a.id.localeCompare(b.id)), [model]);
  // A course keeps its color while it stays in the tray (lib/course-colors.ts).
  const colorMemory = useRef<Map<string, Hue>>(new Map());
  const colors = useMemo(() => {
    const next = assignColors(trayRows, colorMemory.current);
    colorMemory.current = next;
    return next;
  }, [trayRows]);
  const credits = creditProgress(model, transcriptRecords, profile);

  const [open, setOpen] = useState(OPEN_AT_START);
  const [leftOpen, setLeftOpen] = useState(LEFT_OPEN_AT_START);
  const [expanded, setExpanded] = useState<Record<GroupKey, boolean>>({ check: false, can: false, taking: false, later: false, done: false });
  const [detailId, setDetailId] = useState<string | null>(initialCourseId);
  const [detailOpen, setDetailOpen] = useState(initialCourseId !== null);
  const [degreeOpen, setDegreeOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [freshResult, setFreshResult] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const pageRef = useRef<HTMLDivElement>(null);
  const editMotion = useRef<EditMotion | null>(null);
  const autoMotion = useRef<AutoMotion | null>(null);
  // What is moving now. `token` changes whenever another action takes over, so late callbacks from the old one do nothing.
  const live = useRef({ token: 0, animations: new Set<Animation>(), flyers: new Set<() => void>() });
  const alive = useRef(true);
  const focusAfterExpand = useRef<GroupKey | null>(null);

  const untouched = !model.hasTranscript && Object.values(courseStatuses).every((status) => status === "notTaken");
  const idle = hydrated && untouched && !major;
  const sampleOnly = model.hasTranscript && transcriptRecords.every((record) => record.id.startsWith("sample-"));
  const say = setAnnouncement;

  // Arriving from the landing's "Pick courses by hand": the student already
  // chose how to start, so the major comes next, not this page's start options.
  // The landing's link that opened it is gone, so closing it focuses the degree line (focusDegreeOnClose).
  const majorAsked = useRef(false);
  const focusDegreeOnClose = useRef(false);
  useEffect(() => {
    if (!hydrated || majorAsked.current || !asksForMajor(window.location.search)) return;
    majorAsked.current = true;
    router.replace(window.location.pathname, { scroll: false });
    if (!idle) return;
    focusDegreeOnClose.current = true;
    setDegreeOpen(true);
  }, [hydrated, idle, router]);

  /* ---------- motion ---------- */

  const track = useCallback((animations: Animation | Animation[]) => {
    for (const animation of [animations].flat()) live.current.animations.add(animation);
  }, []);

  /** Ends whatever is moving: flights and moves stop where they belong, and hidden tray rows show. */
  const settle = useCallback(() => {
    const now = live.current;
    now.token += 1;
    now.animations.forEach((animation) => animation.cancel());
    now.animations.clear();
    now.flyers.forEach((remove) => remove());
    now.flyers.clear();
    autoMotion.current = null;
    editMotion.current = null;
    setPending(new Set());
    setChosen(new Set());
  }, []);

  // Leaving the page ends its motion and cancels an Auto that has not committed.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      settle();
    };
  }, [settle]);

  // Turning on reduced motion mid-reveal stops the movement (MOTION.md §10).
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => query.matches && settle();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [settle]);

  const prepareEdit = (ready: (model: CourseModel) => boolean, mode: Mode, duration: number, focus: readonly string[]) => {
    settle();
    editMotion.current = { first: mode !== "instant" && pageRef.current ? measure(pageRef.current) : new Map(), duration, mode, focus, ready };
  };

  const land = useCallback((id: string, token: number) => {
    if (live.current.token !== token) return;
    setPending((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  /** Auto (MOTION.md §8): the rest moves aside while each pick flies to its slot and lands. */
  const playAuto = useCallback(
    (root: HTMLElement, queued: AutoMotion) => {
      const mode = queued.mode === "animate" && reducedMotion() ? "fade" : queued.mode;
      const token = live.current.token;
      if (mode !== "animate") {
        setPending(new Set());
        if (mode === "fade") {
          queued.picks.forEach((id, index) => {
            const target = root.querySelector<HTMLElement>(`[data-flip="tray:${CSS.escape(id)}"]`);
            if (target) track(fadeIn(target, index * AUTO_TIMELINE.fadeStagger));
          });
        }
        return;
      }
      // Every destination is read before anything is written (MOTION.md §11).
      const targets = queued.picks.map((id) => {
        const element = root.querySelector<HTMLElement>(`[data-flip="tray:${CSS.escape(id)}"]`);
        return { id, element, to: element?.getBoundingClientRect() };
      });
      track(flip(root, queued.first, { duration: AUTO_TIMELINE.flip }));
      targets.forEach(({ id, element, to }, index) => {
        const from = queued.first.get(`row:${id}`);
        const source = queued.sources.get(id);
        const delay = AUTO_TIMELINE.flightDelay + index * AUTO_TIMELINE.flightStagger;
        if (!element || !to || !from || !source) {
          // Its row was in a closed group or past "Show more": it fades in where it lands.
          if (element) track(fadeIn(element, delay));
          window.setTimeout(() => land(id, token), delay);
          return;
        }
        const flight = fly(source, from, to, delay);
        live.current.flyers.add(flight.remove);
        track(flight.animation);
        flight.animation.finished
          .catch(() => {})
          .finally(() => {
            flight.remove();
            live.current.flyers.delete(flight.remove);
            land(id, token);
          });
      });
    },
    [land, track],
  );

  useLayoutEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const edit = editMotion.current;
    if (edit?.ready(model)) {
      editMotion.current = null;
      if (edit.mode !== "instant") {
        // Reduced motion may have turned on since the press.
        const move = edit.mode === "animate" && !reducedMotion();
        track(flip(root, edit.first, { duration: edit.duration, from: otherPlace, fadeIn: MOVE.fadeIn, move }));
      }
      for (const selector of edit.focus) {
        const target = document.querySelector<HTMLElement>(selector);
        if (target) {
          target.focus();
          break;
        }
      }
    }
    const auto = autoMotion.current;
    if (auto?.ready(model)) {
      autoMotion.current = null;
      playAuto(root, auto);
    }
  }, [model, playAuto, track]);

  useLayoutEffect(() => {
    const key = focusAfterExpand.current;
    if (!key) return;
    focusAfterExpand.current = null;
    const rows = pageRef.current?.querySelectorAll<HTMLElement>(`section[aria-labelledby="group-${key}"] [data-row-open]`);
    rows?.[ROWS_BEFORE_MORE]?.focus();
  }, [expanded]);

  /* ---------- edits ---------- */

  const AUTO_BUTTON = "[data-auto]";
  // After a keyboard edit in the detail: the action that replaced the one pressed, else the detail's Close.
  const DETAIL_FOCUS = ["[data-detail-primary]", ".ui-context__head button"];
  const CREDIT_FOCUS = ["[data-detail-credit]", ".ui-context__head button"];
  const rowButton = (place: "row" | "tray", id: string) => `[data-flip="${place}:${CSS.escape(id)}"] [data-row-open]`;

  /** Where focus goes after a keyboard edit moves this row away: the next row, else the one before, else Auto. */
  const afterRow = (id: string, place: "row" | "tray"): string[] => {
    const buttons = [...(pageRef.current?.querySelectorAll<HTMLElement>(`[data-flip^="${place}:"] [data-row-open]`) ?? [])];
    const index = buttons.findIndex((button) => button.dataset.rowOpen === id);
    const neighbour = (buttons[index + 1] ?? buttons[index - 1])?.dataset.rowOpen;
    return [...(neighbour ? [rowButton(place, neighbour)] : []), AUTO_BUTTON];
  };

  /**
   * One hand edit to a course, committed against the plan as it is. Its toast
   * offers Undo, which puts the course back only while nothing else changed it.
   */
  const commitEdit = async (
    id: string,
    change: { status?: CourseStatus; section?: string },
    { event, focus = [], message }: { event?: MouseEvent; focus?: readonly string[]; message: string },
  ) => {
    const mode = modeOf(event);
    const planned = change.status === undefined ? undefined : change.status === "inProgress";
    if (planned === undefined) settle();
    else prepareEdit((next) => next.rows.get(id)?.inPlan === planned, mode, planned ? MOVE.add : MOVE.remove, mode === "instant" && event ? focus : []);
    const stamp = planStamp;
    const outcome = await transact(courseEdit(id, change), stamp);
    if (outcome.status !== "committed") {
      editMotion.current = null;
      toast({ message: "The plan changed before that edit landed. Try it again.", tone: "error" });
      return;
    }
    say(`${message}.`);
    const receipt = outcome.result;
    toast({
      message,
      action: {
        label: "Undo",
        onClick: () => {
          settle();
          void transact(undoCourseEdit(receipt), stamp).then((undone) => {
            if (undone.status !== "committed" || !undone.result) toast({ message: `Undo is off: ${id} changed since.`, tone: "error" });
          });
        },
      },
    });
  };

  const plan = (id: string, event?: MouseEvent, focus: readonly string[] = []) =>
    commitEdit(id, { status: "inProgress" }, { event, focus, message: `Added ${id} to ${term}` });
  const unplan = (id: string, event?: MouseEvent, focus: readonly string[] = []) =>
    commitEdit(id, { status: "notTaken" }, { event, focus, message: `Removed ${id}` });
  const chooseSection = (id: string, sectionId: string, event: MouseEvent) => {
    const options = sectionCatalog(id);
    const section = options.status === "ready" ? options.result.sections.find((entry) => entry.id === sectionId) : undefined;
    const label = `${id} §${section ? optionLabel(section) : optionIdLabel(sectionId)}`;
    const planned = model.rows.get(id)?.inPlan === true;
    // Picking a section adds the course when it is not planned yet.
    void commitEdit(id, planned ? { section: sectionId } : { status: "inProgress", section: sectionId }, { event, message: `Added ${label}` });
  };
  const markCredit = (id: string, event?: MouseEvent) => {
    prepareEdit((next) => next.rows.get(id)?.status === "done", "instant", 0, event?.detail === 0 ? CREDIT_FOCUS : []);
    updateCoursePlan(manualEdit({ [id]: "completed" }, (current) => ({ manualCredit: [...without(current.manualCredit, id), id], autoPlanned: without(current.autoPlanned, id) })));
    say(`Marked ${id} as credit you have.`);
  };
  /** Takes out every course Auto planned and the student has not touched since. */
  const clearAutoPlan = () => {
    settle();
    const ids = coursePlan.autoPlanned.filter((id) => model.rows.get(id)?.inPlan);
    updateCoursePlan(manualEdit(Object.fromEntries(ids.map((id) => [id, "notTaken" as const])), () => ({ autoPlanned: [], lastAuto: null })));
    toast(`Removed ${ids.length} course${ids.length === 1 ? "" : "s"} Auto added`);
  };
  const autoInTray = coursePlan.autoPlanned.filter((id) => model.rows.get(id)?.inPlan).length;
  const coreProgress = major && !audited
    ? {
        total: major.coreCourseCodes.length,
        done: major.coreCourseCodes.filter((id) => model.rows.get(id)?.status === "done").length,
      }
    : null;
  const clearCredit = (id: string, event?: MouseEvent) => {
    prepareEdit((next) => next.rows.get(id)?.status !== "done", "instant", 0, event?.detail === 0 ? CREDIT_FOCUS : []);
    updateCoursePlan(manualEdit({ [id]: "notTaken" }, (current) => ({ manualCredit: without(current.manualCredit, id) })));
    say(`Removed your credit mark from ${id}.`);
  };

  /* ---------- Auto ---------- */

  const lastAuto = coursePlan.lastAuto;
  const undoBlocked = lastAuto ? undoBlocker(lastAuto, courseStatuses, plannerState.selectedMajor) : null;
  const autoBusy = running || pending.size > 0;

  const runAuto = async (event: MouseEvent<HTMLButtonElement>) => {
    if (!major) {
      toast("Choose your major first. Auto plans from its core courses.");
      setDegreeOpen(true);
      return;
    }
    if (autoBusy || !hydrated) return;
    settle();
    const token = live.current.token;
    const stale = () => !alive.current || live.current.token !== token;
    const mode = modeOf(event);
    // The choice the transaction will make, from the same candidates, so the picked rows can tint before the plan moves.
    const preview = planAuto(profile, plannerState, major).outcome.planned;
    setRunning(true);
    setFreshResult(false);
    if (mode === "animate" && preview.length > 0) {
      await wait(AUTO_TIMELINE.engine);
      if (stale()) return void (alive.current && setRunning(false));
      setChosen(new Set(preview));
      await wait(AUTO_TIMELINE.tint);
      if (stale()) return void (alive.current && setRunning(false));
    }
    const root = pageRef.current;
    const sources = new Map(
      preview.flatMap((id) => {
        const element = root?.querySelector<HTMLElement>(`[data-flip="row:${CSS.escape(id)}"]`);
        return element ? [[id, element] as const] : [];
      }),
    );
    autoMotion.current =
      preview.length > 0
        ? { token, first: mode === "animate" && root ? measure(root) : new Map(), sources, picks: preview, mode, ready: (next) => preview.every((id) => next.rows.get(id)?.inPlan) }
        : null;
    setChosen(new Set());
    setPending(new Set(mode === "animate" ? preview : []));
    const outcome = await transact(autoTransaction(profile, major, { id: `auto-${Date.now().toString(36)}`, at: new Date().toISOString() }), planStamp);
    if (!alive.current) return;
    if (autoMotion.current?.token === token) {
      // The commit did not carry the preview's picks (refused, or the plan moved meanwhile): show the plan as it is.
      autoMotion.current = null;
      setPending(new Set());
    }
    setRunning(false);
    if (outcome.status !== "committed" || outcome.result === "major-changed") {
      toast({ message: "The plan changed while Auto ran. Press Auto again.", tone: "error" });
      return;
    }
    if (outcome.result.changes.length === 0) {
      toast(audited && audited.needed.size === 0 ? "Nothing to plan. Your degree needs no more courses." : `Nothing new to plan for ${term}`);
      return;
    }
    const planned = outcome.result.planned.length;
    setFreshResult(mode !== "instant");
    say(planned > 0 ? `Planned ${planned} course${planned === 1 ? "" : "s"} for ${term}.` : `Removed ${outcome.result.unplanned.length} you no longer need.`);
    if (mode === "instant") pageRef.current?.querySelector<HTMLElement>(AUTO_BUTTON)?.focus();
  };

  const undoAuto = async (event: MouseEvent<HTMLButtonElement>) => {
    if (!lastAuto || undoBlocked) return;
    const back = lastAuto.changes;
    const mode = modeOf(event);
    // Focus was on Undo, which goes away: the tray's Auto takes it.
    prepareEdit((next) => back.every((change) => next.rows.get(change.code)?.inPlan === (change.from === "inProgress")), mode, AUTO_TIMELINE.undo, mode === "instant" ? [AUTO_BUTTON] : []);
    const outcome = await transact(undoAutoTransaction(plannerState.selectedMajor), planStamp);
    if (outcome.status === "committed" && outcome.result) {
      toast(`${term} is back to how it was`);
      say(`${term} is back to how it was.`);
    } else {
      editMotion.current = null;
      toast({ message: "Undo is off: the plan changed since Auto ran.", tone: "error" });
    }
  };

  const plannedByRun = lastAuto?.changes.filter((change) => change.to === "inProgress").length ?? 0;
  const resultText =
    plannedByRun > 0 ? `Planned ${plannedByRun} course${plannedByRun === 1 ? "" : "s"}` : `Removed ${lastAuto?.changes.length ?? 0} you no longer need`;
  // The line keeps its place while rows fly, so nothing jumps when it appears (MOTION.md §8).
  const showResult = Boolean(lastAuto) && !undoBlocked;

  /* ---------- detail ---------- */

  const openCourse = useCallback(
    (id: string) => {
      if (!model.rows.has(id)) return;
      setDetailId(id);
      setDetailOpen(true);
    },
    [model],
  );
  const navigation = useMemo<CourseNavigation>(() => ({ open: openCourse, isKnown: (id) => model.rows.has(id) }), [openCourse, model]);
  const openRequirement = useCallback((key: string) => {
    setDetailId(`${REQUIREMENT_PREFIX}${key}`);
    setDetailOpen(true);
  }, []);
  // The panel shows a course, or a requirement from What's left (its id carries REQUIREMENT_PREFIX).
  const leftKey = detailId?.startsWith(REQUIREMENT_PREFIX) ? detailId.slice(REQUIREMENT_PREFIX.length) : null;
  const detailRow = detailId && leftKey === null ? model.rows.get(detailId) : undefined;
  const leftItem = useMemo<LeftItem | undefined>(() => {
    if (!audited || leftKey === null) return undefined;
    for (const area of audited.areas) {
      const requirement = area.requirements.find((entry) => entry.key === leftKey);
      if (requirement) return { kind: "requirement", requirement, areaTitle: area.title };
    }
    const item = audited.advisor.find((entry) => entry.key === leftKey);
    return item ? { kind: "advisor", item, areaTitle: audited.areas.find((area) => area.area === item.area)!.title } : undefined;
  }, [audited, leftKey]);
  useEffect(() => {
    if (detailId && leftKey === null && detailOpen) loadSections([detailId]);
  }, [loadSections, detailOpen, detailId, leftKey]);
  useEffect(() => {
    if (trayRows.length > 0) loadSections(trayRows.map((row) => row.id));
  }, [loadSections, trayRows]);

  const placed = useMemo(
    () => sectionPlan.courses.flatMap((course) => (course.section ? [{ section: course.section, hue: colors.get(course.code) }] : [])),
    [sectionPlan, colors],
  );

  // Row and detail callbacks read the latest render through a ref, so memoized rows never re-render for them.
  const latest = useRef({ plan, unplan, openCourse, afterRow });
  useLayoutEffect(() => {
    latest.current = { plan, unplan, openCourse, afterRow };
  });
  const rowActions = useMemo<RowActions>(
    () => ({
      open: (id) => latest.current.openCourse(id),
      add: (id, event) => void latest.current.plan(id, event, latest.current.afterRow(id, "row")),
      remove: (id, event) => void latest.current.unplan(id, event, latest.current.afterRow(id, "tray")),
    }),
    [],
  );
  // A keyboard edit from the detail keeps focus there, on the action that replaced the one pressed.
  const detailActions: DetailActions = {
    plan: (id, event) => void plan(id, event, DETAIL_FOCUS),
    unplan: (id, event) => void unplan(id, event, DETAIL_FOCUS),
    markCredit,
    clearCredit,
    chooseSection,
  };

  /** ↑/↓ on a row moves to the next one; with the detail open, the detail follows without animating. */
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target as HTMLElement;
    if (!target.matches("[data-row-open]")) return;
    const buttons = [...(pageRef.current?.querySelectorAll<HTMLElement>("[data-row-open]") ?? [])];
    const next = buttons[buttons.indexOf(target) + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.scrollIntoView({ block: "nearest" });
    if (detailOpen) setDetailId(next.dataset.rowOpen!);
  };

  /* ---------- search ---------- */

  const searchCourses = useMemo(() => [...model.rows.values()].map((row) => ({ id: row.id, title: row.title })), [model]);
  // Search ranks the degree's courses first: what the audit still needs, or a sample major's core list.
  const coreSet = useMemo<ReadonlySet<string>>(() => audited?.needed ?? new Set(major?.coreCourseCodes ?? []), [audited, major]);
  const instructors = useMemo(
    () =>
      instructorIndex(
        profile.catalog.flatMap((course) => {
          const options = sectionCatalog(course.id);
          return options.status === "ready" ? options.result.sections : [];
        }),
      ),
    // catalogVersion is how the catalog says it has more loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, sectionCatalog, catalogVersion],
  );
  const [searchInstructor, setSearchInstructor] = useState<{ id: string; name: string } | null>(null);
  const searchProvider = useMemo<ShellSearchProvider>(
    () => ({
      placeholder: "Search courses",
      emptyQueryHint: "Type a course code like 1030, a title, or an instructor.",
      planShortcut: true,
      search: (query) => {
        const results = searchCatalog(query, searchCourses, instructors, coreSet);
        return [
          {
            id: "courses",
            label: "Courses",
            items: results.courses.map((course): SearchItem => ({ id: course.id, code: course.id, title: course.title, meta: searchMeta(model.rows.get(course.id)) })),
          },
          {
            id: "instructors",
            label: "Instructors",
            items: results.instructors.map((instructor): SearchItem => ({ id: `${INSTRUCTOR_ITEM}${instructor.name}`, title: instructor.name, meta: instructor.courseIds[0] })),
          },
        ];
      },
      onSelect: (item, { plan: wantsPlan }) => {
        if (item.id.startsWith(INSTRUCTOR_ITEM)) {
          const name = item.id.slice(INSTRUCTOR_ITEM.length);
          const first = instructors.find((instructor) => instructor.name === name)?.courseIds[0];
          if (first) {
            setSearchInstructor({ id: first, name });
            latest.current.openCourse(first);
          }
          return;
        }
        if (wantsPlan) {
          const row = model.rows.get(item.id);
          if (row?.status === "available" || row?.status === "check") void latest.current.plan(item.id);
          else if (row?.status === "planned") void latest.current.unplan(item.id);
          else if (row) toast(`${item.id} can't be added: ${searchMeta(row).toLowerCase()}. Press Enter to see why.`);
          return true;
        }
        setSearchInstructor(null);
        latest.current.openCourse(item.id);
      },
    }),
    [model, searchCourses, instructors, coreSet],
  );
  useShellSearch(searchProvider);

  const instructorForDetail =
    searchInstructor && searchInstructor.id === detailId ? searchInstructor.name : detailId === initialCourseId ? initialInstructor : null;
  const source = !model.hasTranscript ? "none" : sampleOnly ? "sample" : "transcript";

  return (
    <CourseNavigationContext.Provider value={navigation}>
      <div className={styles.page} ref={pageRef} onKeyDown={onListKey}>
        <h1 className={styles.srOnly}>Courses</h1>
        <div className={styles.phoneSearch}>
          <SearchTrigger shortcut="" onClick={openSearch} />
        </div>
        <div className={styles.degree}>
          <button type="button" className={styles.degreeButton} data-degree="" aria-haspopup="dialog" onClick={() => setDegreeOpen(true)}>
            {major?.name ?? "Choose your major"}
            <ChevronDown size={16} />
          </button>
          {!audited && (major || model.hasTranscript) ? (
            <span className={styles.progress}>
              {credits} of {DEGREE_CREDITS} credits
            </span>
          ) : null}
        </div>
        {degree.kind === "unaudited" && hydrated ? (
          <p className={styles.degreeNote}>
            The degree check covers Computer Science and Computer Engineering only.
            {major && major.department !== "—" ? ` For ${major.name}, Courses lists a sample of its courses.` : ""}
          </p>
        ) : null}

        {!hydrated ? (
          <div className={styles.loading} role="status" aria-label="Loading your plan">
            <span className={styles.shimmer} />
          </div>
        ) : idle ? (
          <EmptyState
            onImport={importTranscript}
            onSample={() => {
              applyTranscriptRecords(sampleTranscript);
              say("Added the sample transcript. Choose your major, then press Auto.");
            }}
            onByHand={() => {
              // This empty state, opener included, unmounts once a major is chosen.
              focusDegreeOnClose.current = true;
              setDegreeOpen(true);
            }}
          />
        ) : (
          <>
            {audited ? (
              <WhatsLeft
                degree={audited}
                open={leftOpen}
                onToggle={(key: LeftGroupKey) => setLeftOpen((current) => ({ ...current, [key]: !current[key] }))}
                selectedKey={detailOpen ? leftKey : null}
                onOpen={openRequirement}
              />
            ) : null}
            <TermTray
              term={term}
              rows={trayRows}
              colors={colors}
              pending={pending}
              // Starting value: 15 is the common four-year pace (school.ts), not a rule; no data on what students take.
              budget={profile.autoCreditBudget}
              // The spinner covers the wait (MOTION.md §8); presses are ignored until the last row lands (runAuto).
              running={running}
              onAuto={runAuto}
              result={showResult ? { text: resultText, hidden: autoBusy, fresh: freshResult, onUndo: undoAuto } : null}
              selectedId={detailOpen ? detailId : null}
              actions={rowActions}
              weekHref={LENS_HREF.week}
              emptyText={audited ? "Auto fills this term from courses your degree still needs." : "Auto fills this term from courses you can take."}
              more={autoInTray > 0 ? [{ id: "clear-auto", label: `Remove the ${autoInTray === 1 ? "course" : `${autoInTray} courses`} Auto added`, onSelect: clearAutoPlan, destructive: true }] : []}
            />
            {major ? null : <ChooseMajor term={term} onChoose={() => setDegreeOpen(true)} />}
            <CourseGroups
              groups={groups}
              model={model}
              open={open}
              onToggle={(key) => setOpen((current) => ({ ...current, [key]: !current[key] }))}
              expanded={expanded}
              onExpand={(key) => {
                focusAfterExpand.current = key;
                setExpanded((current) => ({ ...current, [key]: true }));
              }}
              selectedId={detailOpen ? detailId : null}
              chosen={chosen}
              actions={rowActions}
              term={term}
            />
            {hasDepartment ? (
              <button type="button" className={styles.more} onClick={() => setWide((value) => !value)}>
                {wide ? `Show only your degree's courses` : "Show courses from every department"}
              </button>
            ) : null}
          </>
        )}
        <p className={styles.srOnly} role="status" aria-live="polite">
          {announcement}
        </p>
      </div>

      <ContextPanel
        open={detailOpen && (detailRow !== undefined || leftItem !== undefined)}
        onClose={() => setDetailOpen(false)}
        title={detailRow?.id ?? (leftItem?.kind === "requirement" ? leftItem.requirement.name : leftItem?.item.name) ?? ""}
        heading={
          detailRow ? (
            <span className={styles.panelHeading}>
              <span className={styles.panelCode}>{detailRow.id}</span>
              <span className={styles.creditsTag}>{creditsLabel(detailRow.credits)}</span>
            </span>
          ) : leftItem ? (
            // The area sits where a course's code does; the body names the requirement, as it names a course.
            <span className={styles.panelHeading}>
              <span className={styles.panelArea}>{leftItem.areaTitle}</span>
            </span>
          ) : undefined
        }
        // The selected row, or the degree line when that row is not on the page (a searched course, a closed group).
        returnFocus={() =>
          (detailId ? pageRef.current?.querySelector<HTMLElement>(`[data-row-open="${CSS.escape(detailId)}"]`) : null) ??
          pageRef.current?.querySelector<HTMLElement>("[data-degree]") ??
          null
        }
      >
        {detailRow ? (
          <CourseDetail
            key={`${detailRow.id}|${instructorForDetail ?? ""}`}
            row={detailRow}
            model={model}
            profile={profile}
            options={sectionCatalog(detailRow.id)}
            placed={placed}
            chosenSectionId={plannerState.selectedSections[detailRow.id]}
            initialInstructor={instructorForDetail}
            degreeNote={degreeNote(detailRow, audited !== null, coreSet)}
            actions={detailActions}
            planLoaded={hydrated}
          />
        ) : leftItem ? (
          <RequirementDetail key={leftKey} entry={leftItem} model={model} />
        ) : null}
      </ContextPanel>

      <DegreeDialog
        open={degreeOpen}
        onOpenChange={setDegreeOpen}
        // Read once, as it closes, for an opener that may be gone by then; the degree line's own button stays.
        returnFocus={() => {
          if (!focusDegreeOnClose.current) return null;
          focusDegreeOnClose.current = false;
          return pageRef.current?.querySelector<HTMLElement>("[data-degree]") ?? null;
        }}
        major={plannerState.selectedMajor}
        onChoose={(id: MajorId) => {
          setSelectedMajor(id);
          say(`Major set to ${getMajorById(id)?.name}.`);
        }}
        source={source}
        core={coreProgress}
        catalog={audited ? { year: audited.catalogYear, program: audited.programName } : null}
        onSample={() => {
          applyTranscriptRecords(sampleTranscript);
          setDegreeOpen(false);
          say("Added the sample transcript. Press Auto to plan from it.");
        }}
        onImport={() => {
          setDegreeOpen(false);
          importTranscript();
        }}
      />
    </CourseNavigationContext.Provider>
  );
}

/** One line in the course detail on how the degree treats the course, or null. */
function degreeNote(row: CourseRowModel, audited: boolean, degreeCourses: ReadonlySet<string>): string | null {
  if (row.waiver) return `${row.waiver} covers it as a prerequisite, but your degree still lists ${row.id}. Only an advisor can waive it.`;
  if (!degreeCourses.has(row.id)) return null;
  return audited ? "Your degree still needs this course." : "On your major's core list.";
}

/**
 * In place of the catalog before a major is chosen: what choosing one
 * shows, and the one way to do it. The groups list a degree's courses; with
 * no degree they would list every department's, most of them as rules to check.
 */
function ChooseMajor({ term, onChoose }: { term: string; onChoose: () => void }) {
  return (
    <section className={styles.noMajor} aria-labelledby="no-major-title">
      <h2 className={styles.noMajorTitle} id="no-major-title">
        See your degree&apos;s courses
      </h2>
      <p className={styles.noMajorText}>Choose your major, and Courses lists what you can take in {term}, what comes later, and what to check with an advisor.</p>
      <Button variant="secondary" aria-haspopup="dialog" onClick={onChoose}>
        Choose your major
      </Button>
    </section>
  );
}

function EmptyState({ onImport, onSample, onByHand }: { onImport: () => void; onSample: () => void; onByHand: () => void }) {
  return (
    <section className={styles.empty} aria-labelledby="empty-title">
      <h2 className={styles.emptyTitle} id="empty-title">
        Start with what you&apos;ve taken
      </h2>
      <ul className={styles.emptyList}>
        <li>
          <button type="button" className={styles.emptyOption} onClick={onImport}>
            <strong>Import your transcript</strong>
            <span>The unofficial transcript PDF from myUNT. Nothing is uploaded.</span>
          </button>
        </li>
        <li>
          <button type="button" className={styles.emptyOption} onClick={onSample}>
            <strong>Try a sample transcript</strong>
            <span>A made-up first year in Computer Science.</span>
          </button>
        </li>
        <li>
          <button type="button" className={styles.emptyOption} onClick={onByHand}>
            <strong>Pick courses by hand</strong>
            <span>Choose your major, then add its courses.</span>
          </button>
        </li>
      </ul>
    </section>
  );
}
