"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { ContextPanel } from "@/components/ui/ContextPanel";
import { AlertGlyph, BookGlyph, SearchGlyph, ShareGlyph, SlidersGlyph, TrayIn, Undo } from "@/components/ui/icons";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import { toast } from "@/components/ui/Toast";
import { keyboardFocused } from "@/components/ui/input-source";
import { PHONE_QUERY, useMediaQuery } from "@/components/ui/use-media-query";
import { assignColors } from "@/lib/course-colors";
import type { Day, Section } from "@/lib/sections";
import type { WeekDay } from "@/lib/types";
import { answerFor, describeAlternative, type AnswerCourse } from "./answer";
import styles from "./builder.module.css";
import { hasNoSetTime, isTimed, meetingsOverlap } from "./conflicts";
import { ExportSheet } from "./ExportSheet";
import type { BuilderHost } from "./host";
import { NoticeStrip, OptionsStrip } from "./OptionsStrip";
import { EventPanel, OptionDetails } from "./panels";
import { changedCount, newBusyId } from "./limits";
import { addBusy, preferenceSummary, removeBusySpan } from "./preferences";
import { PreferencesPopover } from "./PreferencesPopover";
import { SearchPanel } from "./SearchPanel";
import type { SharedWeek } from "./share";
import { andList, dayLetters, eventsOf, optionName, optionTitle, placeEvents, sectionLabel, walksOf } from "./week";
import { WeekGrid, type Busy, type Ghost, type Outline } from "./WeekGrid";

export type SearchRequest = { nonce: number; query: string };

type Panel = { kind: "event"; code: string } | { kind: "search" } | { kind: "option" };
type Strip =
  /** `instant`: the option on the grid was reached from the keyboard (Auto, Next or Show), so it didn't animate. */
  | { kind: "options"; runId: number | null; shown: ReadonlyArray<Record<string, string>>; index: number; better: boolean; instant: boolean }
  | { kind: "shared"; week: SharedWeek };

const isWeekDay = (day: Day): day is WeekDay => day !== "Sat" && day !== "Sun";

/** A course code never breaks across lines ("PHYS 2220", not "PHYS" over "2220"). */
const keepCodesWhole = (text: string) => text.replace(/\b([A-Z]{3,4}) (\d{4}[A-Z]?)\b/g, "$1\u00a0$2");

const FINE = "(hover: hover) and (pointer: fine)";
/**
 * Week's main region: 960px, narrower from 1200px wide when the page plus the
 * pushed panel (and 24px either side) wouldn't fit, so pushing never moves the
 * grid off screen. builder.module.css sizes .page the same way.
 */
const MAIN_MAX = "min(960px, 100vw - var(--context-w) - var(--context-gap) - 48px)";
/** Same sections for the same courses, whatever order the keys came in. */
const same = (a: Record<string, string> | undefined, b: Record<string, string> | undefined) => {
  const key = (map: Record<string, string> | undefined) => JSON.stringify(Object.entries(map ?? {}).sort(([x], [y]) => x.localeCompare(y)));
  return key(a) === key(b);
};
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

type Props = {
  host: BuilderHost;
  /** The schedule's name, as the switcher shows it. */
  scheduleName: string;
  /** Opens search, from the top bar or ⌘K; a new nonce opens it again. */
  searchRequest: SearchRequest | null;
  /** A week from a share link, shown for the student to use or dismiss. */
  shared: SharedWeek | { error: string } | null;
  onSharedSeen: () => void;
};

/**
 * Week (03-schedule-builder.html, as amended by untangle-v3.md): one
 * Preferences line, one answer, the grid. Search, a selected event,
 * Preferences and an alternative's details open the contextual panel; Auto's
 * alternatives show one at a time in the strip above the grid.
 */
export function ScheduleBuilder({ host, scheduleName, searchRequest, shared, onSharedSeen }: Props) {
  const phone = useMediaQuery(PHONE_QUERY);
  const fine = useMediaQuery(FINE);
  const feed = host.optimizer;
  const [panel, setPanel] = useState<Panel | null>(null);
  const [strip, setStrip] = useState<Strip | null>(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Section | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  /** Preferences is its own popover (a sheet on phones), not the contextual panel: the week stays in view behind it. */
  const [prefsOpen, setPrefsOpen] = useState(false);
  const prefsButton = useRef<HTMLButtonElement>(null);
  /** The last change came from the keyboard: the grid updates without moving (MOTION.md §3). */
  const keyboard = useRef(false);
  /** The last change undoes or leaves a preview: an exit, so it moves a little faster (MOTION.md §7). */
  const exiting = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const colors = useRef(new Map<string, 1 | 2 | 3 | 4 | 5 | 6>());

  // Week's main region stops at 960px; the contextual panel lines up beside it (globals.css, ui.css).
  useLayoutEffect(() => {
    document.body.style.setProperty("--main-max", MAIN_MAX);
    // On phones, toasts (Undo stays until dismissed) sit above the Add and Auto bar, not on it.
    document.body.style.setProperty("--toast-lift", "68px");
    return () => {
      document.body.style.removeProperty("--main-max");
      document.body.style.removeProperty("--toast-lift");
    };
  }, []);

  // The current week, and what the grid shows: the week, or an alternative over it.
  const placed = host.courses.flatMap((course) => (course.section ? [course.section] : []));
  const current = Object.fromEntries(placed.map((section) => [section.courseCode, section.id]));
  // A shared week previews, and applies, only the sections that resolved this term.
  const sharedResolved =
    strip?.kind === "shared" ? Object.fromEntries(Object.entries(strip.week.sections).filter(([code, id]) => host.find(code, id))) : undefined;
  const previewMap = strip?.kind === "options" ? strip.shown[strip.index] : sharedResolved;
  const previewing = Boolean(previewMap);
  const shownSections = previewMap
    ? [
        ...placed.filter((section) => !(section.courseCode in previewMap)),
        ...Object.entries(previewMap).flatMap(([code, id]) => {
          const found = host.find(code, id) ?? placed.find((section) => section.courseCode === code);
          return found ? [found] : [];
        }),
      ]
    : placed;

  const now = useMemo(() => {
    const events = eventsOf(placed);
    return { events, walks: walksOf(events, host.walk), sections: placed };
    // `placed` is rebuilt every render; its ids say when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(current), host.walk]);
  const shownKey = JSON.stringify(shownSections.map((section) => section.id).sort());
  const shown = useMemo(() => {
    const events = eventsOf(shownSections);
    return { events, walks: walksOf(events, host.walk), sections: shownSections, placements: placeEvents(events) };
    // `shownSections` is rebuilt every render; `shownKey` names its sections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, host.walk]);

  // Every course that can be drawn keeps its hue as others come and go (lib/course-colors.ts).
  const colorCodes = [...new Set([...host.courses.map((course) => course.code), ...shownSections.map((s) => s.courseCode), ...(preview ? [preview.courseCode] : [])])].join("|");
  const hues = useMemo(() => {
    colors.current = assignColors(colorCodes.split("|").filter(Boolean).map((id) => ({ id, department: id.split(" ")[0] })), colors.current);
    return colors.current;
  }, [colorCodes]);
  const hueOf = (code: string) => hues.get(code) ?? 1;

  // Auto's stream: a new run's first answer previews at once; a later answer to the same run
  // never moves a grid the student is looking at (MOTION.md §9).
  if (strip?.kind === "options" && feed.runId !== null && feed.options.length > 0) {
    if (strip.runId !== feed.runId) {
      setStrip({ ...strip, runId: feed.runId, shown: feed.options, index: 0, better: false });
    } else if (JSON.stringify(strip.shown) !== JSON.stringify(feed.options)) {
      if (same(strip.shown[strip.index], feed.options[strip.index])) setStrip({ ...strip, shown: feed.options });
      else if (!strip.better) setStrip({ ...strip, better: true });
    }
  }
  const selectedCourse = panel?.kind === "event" ? host.courses.find((course) => course.code === panel.code) ?? null : null;
  if (panel?.kind === "event" && !selectedCourse) setPanel(null);
  if (panel?.kind === "option" && strip?.kind !== "options") setPanel(null);

  const { load } = host.search;
  const selectedCode = selectedCourse?.code ?? null;
  useEffect(() => {
    if (selectedCode) load([selectedCode]);
  }, [load, selectedCode]);

  // A changed preference while alternatives are open searches again; the grid keeps its preview until the answer comes.
  useEffect(() => {
    if (strip?.kind === "options" && feed.stale && feed.status !== "running") feed.run();
  }, [strip?.kind, feed]);

  useEffect(() => {
    if (!searchRequest) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery(searchRequest.query);
    setPanel({ kind: "search" });
  }, [searchRequest]);

  /** A week from a link or a saved file: shown over the current one for the student to use or dismiss. */
  const openWeek = (week: SharedWeek) => {
    if (week.term !== host.term.id) {
      toast({ message: `That week is for another term, not ${host.term.label}.`, tone: "error" });
      return;
    }
    load(Object.keys(week.sections));
    setStrip({ kind: "shared", week });
  };

  useEffect(() => {
    if (!shared) return;
    onSharedSeen();
    if ("error" in shared) {
      toast({ message: `That share link can't be opened. ${shared.error}`, tone: "error" });
      return;
    }
    openWeek(shared);
    // Runs once per link; the host's search is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);

  // A toast keeps the Undo from the render that showed it, before its edit committed and made Undo possible.
  const canUndo = useRef(host.edits.canUndo);
  useLayoutEffect(() => {
    canUndo.current = host.edits.canUndo;
  });
  const undo = (fromKeyboard: boolean) => {
    if (!canUndo.current) return;
    keyboard.current = fromKeyboard;
    exiting.current = true;
    host.edits.undo();
  };
  // The toast's Undo can be pressed with Enter; it then changes the grid without motion.
  const undoAction = { label: "Undo", onClick: () => undo(keyboardFocused()) };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z" && !isEditable(event.target)) {
        event.preventDefault();
        undo(true);
      } else if (event.key === "Escape" && !event.defaultPrevented && !panel && !prefsOpen && strip && !document.querySelector('[aria-modal="true"]')) {
        keyboard.current = true;
        closeStrip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const closePrefs = useCallback(() => setPrefsOpen(false), []);
  const prefsAnchor = useCallback(() => prefsButton.current, []);

  const openPanel = (next: Panel) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel(next);
  };
  const closePanel = () => {
    setPanel(null);
    setPreview(null);
  };

  const place = (section: Section, overlaps: string[], fromKeyboard: boolean) => {
    const what = section.courseCode in current ? `Moved ${section.courseCode} to section ${sectionLabel(section)}` : `Added ${section.courseCode} section ${sectionLabel(section)}`;
    const refused = host.edits.place(section.courseCode, section.id);
    // Nothing changed, so there is nothing to undo: an Undo here would take back an earlier edit.
    if (refused) return void toast({ message: refused, tone: "error" });
    keyboard.current = fromKeyboard;
    setPreview(null);
    toast({ message: overlaps.length > 0 ? `${what}. It overlaps ${andList(overlaps)}.` : what, action: undoAction });
  };
  const pickOutline = (code: string, sectionId: string, fromKeyboard: boolean) => {
    const section = host.find(code, sectionId);
    if (!section) return false;
    const overlaps = placed.filter((other) => other.courseCode !== code && other.meetings.some((m) => section.meetings.some((n) => meetingsOverlap(m, n)))).map((s) => s.courseCode);
    place(section, overlaps, fromKeyboard);
    return true;
  };

  const auto = (fromKeyboard: boolean) => {
    setPanel((open) => (open?.kind === "event" || open?.kind === "option" ? null : open));
    setStrip((open) =>
      open?.kind === "options" ? { ...open, instant: fromKeyboard } : { kind: "options", runId: null, shown: [], index: 0, better: false, instant: fromKeyboard },
    );
    feed.run();
  };
  const closeStrip = (fromKeyboard = false) => {
    keyboard.current ||= fromKeyboard;
    if (strip?.kind === "options") feed.close();
    exiting.current = true;
    setStrip(null);
  };
  const applyShown = () => {
    if (!previewMap || Object.keys(previewMap).length === 0) return;
    // Rechecked here: the button may have drawn before a setting changed.
    if (strip?.kind === "options" && (feed.stale || feed.status === "running")) return;
    const label = strip?.kind === "options" ? optionName(strip.index) : "the shared week";
    keyboard.current = false;
    const refused = host.edits.use(previewMap);
    // Nothing was used: the preview stays, to keep or dismiss.
    if (refused.length === Object.keys(previewMap).length) return void toast({ message: `Nothing from ${label} was used. ${refused.join(" ")}`, tone: "error" });
    closeStrip();
    if (panel?.kind === "option") setPanel(null);
    toast({ message: refused.length > 0 ? `Using ${label}. ${refused.join(" ")}` : `Using ${label}`, action: undoAction });
  };

  // What the grid draws besides the week.
  const others = (code: string) => placed.filter((section) => section.courseCode !== code);
  const clashesWith = (code: string, meeting: Section["meetings"][number]) => others(code).some((section) => section.meetings.some((m) => meetingsOverlap(m, meeting)));
  const ghost: Ghost[] =
    preview && !previewing && current[preview.courseCode] !== preview.id
      ? preview.meetings.filter(isTimed).map((m) => ({ courseCode: preview.courseCode, day: m.day, start: m.startMinutes, end: m.endMinutes, clash: clashesWith(preview.courseCode, m) }))
      : [];
  const outlineCourse = previewing ? null : (dragging ?? selectedCourse?.code ?? null);
  const outlineOptions = outlineCourse ? host.search.options(outlineCourse) : null;
  // Linked options often share a lecture time; one outline per slot keeps the grid readable.
  const slots = new Set<string>();
  const outlines: Outline[] = (outlineOptions ?? [])
    .filter((section) => section.id !== current[outlineCourse!])
    .flatMap((section) => {
      const days = dayLetters(section.meetings.filter(isTimed).map((m) => m.day));
      const meetings = section.meetings.filter(isTimed);
      // eventsOf orders occurrences, so each outline knows which event key it becomes.
      return eventsOf([section]).map((event) => ({
        courseCode: section.courseCode,
        sectionId: section.id,
        label: sectionLabel(section),
        day: event.day,
        start: event.start,
        end: event.end,
        days,
        targetKey: event.key,
        clash: meetings.some((m) => m.day === event.day && m.startMinutes === event.start && clashesWith(section.courseCode, m)),
      }));
    })
    .filter((outline) => {
      const slot = `${outline.day} ${outline.start} ${outline.end}`;
      if (slots.has(slot)) return false;
      slots.add(slot);
      return true;
    });
  const busy: Busy[] = host.preferences.constraints.blocked.map((block) => ({ id: block.id, label: block.label, day: block.day, start: block.start, end: block.end }));

  const answerCourses: AnswerCourse[] = host.courses.map((course) => ({
    code: course.code,
    credits: course.credits,
    state: course.state === "none" ? "pick" : course.state,
    note: course.note,
  }));
  const answer = answerFor({ courses: answerCourses, events: now.events, walks: now.walks, preferences: host.preferences, termLabel: host.term.label });
  const summary = preferenceSummary(host.preferences, host.defaults);
  const prefCount = changedCount(host.preferences, host.defaults);
  const noSetTime = shownSections.filter(hasNoSetTime);
  const running = feed.status === "running";
  const firstAnswerPending = running && (strip?.kind !== "options" || strip.shown.length === 0);
  const identical = previewMap !== undefined && same(Object.fromEntries(Object.entries(current).filter(([code]) => code in previewMap)), previewMap) && strip?.kind === "options";
  const sentence = identical ? "Your week is already the best Auto found." : describeAlternative(now, shown);
  const instant = keyboard.current || (strip?.kind === "options" && strip.instant);
  const exit = exiting.current;
  // Read once per commit: the next change says again where it came from.
  useLayoutEffect(() => {
    keyboard.current = false;
    exiting.current = false;
  });

  const panelTitle =
    panel?.kind === "event"
      ? panel.code
      : panel?.kind === "search"
        ? "Find courses"
        : strip?.kind === "options"
            ? `${optionTitle(strip.index)} next to your week`
            : "";

  const answerLine = (() => {
    if (strip?.kind === "options" && feed.infeasible) {
      return (
        <NoticeStrip
          tone="danger"
          closeLabel="Close"
          onClose={closeStrip}
          actions={feed.infeasible.fixes.slice(0, 2).map((fix) => (
            <Button key={fix.label} variant="secondary" size="sm" onClick={fix.apply}>
              {fix.label}
            </Button>
          ))}
        >
          Nothing fits these preferences. {feed.infeasible.sentence}
        </NoticeStrip>
      );
    }
    if (strip?.kind === "options" && feed.status === "error") {
      return (
        <NoticeStrip tone="danger" closeLabel="Close" onClose={closeStrip} actions={<Button variant="secondary" size="sm" onClick={feed.run}>Try again</Button>}>
          Auto stopped before it found a week. {feed.error}
        </NoticeStrip>
      );
    }
    if (strip?.kind === "options" && strip.shown.length > 0) {
      return (
        <OptionsStrip
          count={running ? "Updating" : `${strip.index + 1} of ${strip.shown.length}`}
          sentence={keepCodesWhole(sentence)}
          searching={running || feed.status === "refining"}
          better={strip.better}
          instant={instant}
          canUse={!identical && !feed.stale && !running}
          hasNext={strip.shown.length > 1}
          onDetails={() => openPanel({ kind: "option" })}
          onShow={(fromKeyboard) =>
            setStrip({ ...strip, shown: feed.options, index: Math.min(strip.index, feed.options.length - 1), better: false, instant: fromKeyboard })
          }
          onNext={(fromKeyboard) => {
            const list = feed.options.length > 0 ? feed.options : strip.shown;
            setStrip({ ...strip, shown: list, index: (strip.index + 1) % list.length, better: false, instant: fromKeyboard });
          }}
          onUse={applyShown}
          onClose={(fromKeyboard) => {
            keyboard.current = fromKeyboard;
            closeStrip();
          }}
        />
      );
    }
    if (strip?.kind === "shared") {
      const codes = Object.keys(strip.week.sections);
      const missing = codes.filter((code) => !(code in (sharedResolved ?? {})));
      const loading = missing.some((code) => host.search.options(code) === null);
      return (
        <NoticeStrip
          tone="brand"
          closeLabel="Keep my week"
          onClose={closeStrip}
          actions={
            <Button size="sm" disabled={loading || missing.length === codes.length} onClick={applyShown}>
              Use this
            </Button>
          }
        >
          {loading
            ? "Loading the shared week."
            : `A shared week of ${codes.length - missing.length} course${codes.length - missing.length === 1 ? "" : "s"}, on the grid now.${missing.length ? ` ${andList(missing)} can't be found this term.` : ""}`}
        </NoticeStrip>
      );
    }
    if (!answer) return null;
    return (
      <div className={styles.answer} data-tone={answer.tone}>
        {answer.tone === "quiet" ? (
          answer.fits ? <StatusGlyph status="planned" label="Fits" /> : null
        ) : (
          <AlertGlyph size={18} className={styles.answerGlyph} />
        )}
        <span>{keepCodesWhole(answer.text)}</span>
        {answer.action === "fix" ? (
          <Button variant="secondary" size="sm" onClick={(event) => auto(event.detail === 0)}>
            Show a fix
          </Button>
        ) : answer.action === "pick" ? (
          <Button variant="secondary" size="sm" onClick={() => openPanel({ kind: "event", code: answer.courseCode })}>
            Pick a section
          </Button>
        ) : null}
      </div>
    );
  })();

  return (
    <div className={styles.page} data-builder={host.brand.id}>
      <div className={styles.head}>
        <div className={styles.title} aria-hidden="true">
          <b>{host.term.label}</b>
          <span>{host.courses.length === 0 ? "No courses yet" : `Built from ${host.courses.length} course${host.courses.length === 1 ? "" : "s"}`}</span>
        </div>
        <div className={styles.headActions}>
          <IconButton label="Undo" size="sm" disabled={!host.edits.canUndo} aria-keyshortcuts="Meta+Z Control+Z" onClick={(event) => undo(event.detail === 0)}>
            <Undo size={20} />
          </IconButton>
          <IconButton label="Export" size="sm" onClick={() => setExporting(true)}>
            <ShareGlyph size={19} />
          </IconButton>
          <span className={styles.headRule} aria-hidden="true" />
          {phone ? null : (
            <button
              type="button"
              className={styles.topButton}
              aria-expanded={panel?.kind === "search"}
              onClick={() => {
                setPrefsOpen(false);
                if (panel?.kind === "search") closePanel();
                else openPanel({ kind: "search" });
              }}
            >
              <BookGlyph size={18} />
              Courses
              {host.courses.length > 0 ? <span className={styles.count}>{host.courses.length}</span> : null}
            </button>
          )}
          <button
            ref={prefsButton}
            type="button"
            className={styles.topButton}
            aria-expanded={prefsOpen}
            aria-haspopup="dialog"
            aria-describedby={summary ? "pref-summary" : undefined}
            onClick={() => {
              if (!prefsOpen) closePanel();
              setPrefsOpen(!prefsOpen);
            }}
          >
            <SlidersGlyph size={18} />
            Preferences
            {prefCount > 0 ? (
              <span className={styles.count} aria-label={`${prefCount} changed`}>
                {prefCount}
              </span>
            ) : null}
          </button>
          <span id="pref-summary" hidden>
            {summary}
          </span>
          {phone ? null : (
            <Button size="sm" icon={<TrayIn size={18} />} loading={firstAnswerPending} loadingLabel="Looking for weeks" disabled={host.courses.length === 0} onClick={(event) => auto(event.detail === 0)}>
              {host.brand.primaryLabel}
            </Button>
          )}
        </div>
      </div>

      <div className={styles.answerSlot} aria-live="polite">
        {answerLine}
      </div>

      <WeekGrid
        label={`${host.term.label} week${previewing ? ", previewing another week" : ""}`}
        events={shown.events}
        placements={shown.placements}
        walks={shown.walks}
        hueOf={hueOf}
        kept={new Set(host.courses.filter((course) => course.locked).map((course) => course.code))}
        selectedCourse={selectedCourse?.code ?? null}
        outlines={outlines}
        ghost={ghost}
        busy={busy}
        limits={host.preferences.constraints}
        motion={{ key: shownKey, instant, exit }}
        interactive={!previewing}
        phone={phone}
        onSelect={(event, fromKeyboard) => {
          if (panel?.kind === "event" && panel.code === event.courseCode) closePanel();
          else {
            keyboard.current = fromKeyboard;
            openPanel({ kind: "event", code: event.courseCode });
          }
        }}
        onPick={pickOutline}
        onDrag={setDragging}
        onBusy={(block) => {
          const day = block.day;
          if (!isWeekDay(day)) return;
          const id = newBusyId();
          const { start, end } = block;
          host.setPreferences((p) => addBusy(p, { label: "Busy", day, start, end }, id));
          // Undo takes back this time alone, keeping preferences changed since.
          toast({ message: "Added a busy time. Auto keeps it free.", action: { label: "Undo", onClick: () => host.setPreferences((p) => removeBusySpan(p, id, start, end, newBusyId)) } });
        }}
        footer={
          noSetTime.length > 0 || host.provenance === "sample" ? (
            <div className={styles.gridFoot}>
              {noSetTime.length > 0 ? (
                <>
                  <span className={styles.label}>No set time</span>
                  {noSetTime.map((section) => (
                    <button
                      key={section.courseCode}
                      type="button"
                      className={styles.pill}
                      data-hue={hueOf(section.courseCode)}
                      disabled={previewing}
                      onClick={() => openPanel({ kind: "event", code: section.courseCode })}
                    >
                      <span className={styles.code}>{section.courseCode}</span>
                      {section.online || section.async ? "Online" : "TBA"}
                    </button>
                  ))}
                </>
              ) : null}
              {host.provenance === "sample" ? (
                <span className={styles.tag}>
                  <ProvenanceTag source="These sections are made up for planning. Real ones replace them when UNT's class schedule loads.">Sample sections</ProvenanceTag>
                </span>
              ) : null}
            </div>
          ) : null
        }
        empty={
          host.courses.length === 0 ? (
            <div className={styles.empty}>
              <div>
                <h2>Add your first course</h2>
                <p className={styles.meta}>Search by course code, title or class number.</p>
                <Button icon={<SearchGlyph size={18} />} onClick={() => openPanel({ kind: "search" })}>
                  Search courses
                </Button>
              </div>
            </div>
          ) : null
        }
      />

      {phone ? (
        <div className={styles.actionBar} data-glass="">
          <Button variant="secondary" icon={<SearchGlyph size={20} />} onClick={() => openPanel({ kind: "search" })}>
            Add
          </Button>
          <Button icon={<TrayIn size={20} />} loading={firstAnswerPending} loadingLabel="Looking" disabled={host.courses.length === 0} onClick={(event) => auto(event.detail === 0)}>
            {host.brand.primaryShort}
          </Button>
        </div>
      ) : null}

      <ContextPanel open={panel !== null} onClose={closePanel} title={panelTitle} returnFocus={() => trigger.current}>
        {panel?.kind === "search" ? (
          <SearchPanel host={host} query={query} onQuery={setQuery} week={placed} onPlace={place} onPreview={setPreview} autoFocus={!phone} />
        ) : panel?.kind === "event" && selectedCourse ? (
          <EventPanel
            course={selectedCourse}
            options={host.search.options(selectedCourse.code)}
            week={placed}
            termLabel={host.term.label}
            onKeep={(kept) => {
              host.edits.keep(selectedCourse.code, kept);
              toast({ message: kept ? `Auto will keep ${selectedCourse.code} where it is` : `Auto may move ${selectedCourse.code}`, action: undoAction });
            }}
            onMove={place}
            onPreview={setPreview}
            onRemove={(fromKeyboard) => {
              keyboard.current = fromKeyboard;
              closePanel();
              host.edits.remove(selectedCourse.code);
              toast({ message: `Removed ${selectedCourse.code}`, action: undoAction });
            }}
          />
        ) : panel?.kind === "option" && strip?.kind === "options" ? (
          <OptionDetails
            now={now}
            option={shown}
            label={optionTitle(strip.index)}
            reasons={previewMap ? feed.explain(previewMap) : []}
            onUse={applyShown}
            canUse={!identical && !feed.stale && !running}
          />
        ) : null}
      </ContextPanel>

      <PreferencesPopover
        open={prefsOpen}
        onClose={closePrefs}
        anchor={prefsAnchor}
        phone={phone}
        ready={host.preferencesReady}
        preferences={host.preferences}
        defaults={host.defaults}
        onChange={host.setPreferences}
        newId={newBusyId}
        courses={host.courses}
        // No toast here: the locked row appearing is the feedback and its unlock button is the undo.
        // An Undo toast stays until dismissed and would cover the bottom of the popover.
        onKeep={(code, kept) => host.edits.keep(code, kept)}
        options={host.search.options}
        load={host.search.load}
        touch={!fine}
      />

      <ExportSheet
        open={exporting}
        onOpenChange={setExporting}
        phone={phone}
        host={host}
        sections={placed}
        events={now.events}
        hueOf={hueOf}
        scheduleName={scheduleName}
        onOpenWeek={openWeek}
      />
    </div>
  );
}
