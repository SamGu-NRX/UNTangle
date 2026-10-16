"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button, IconButton } from "@/components/ui/Button";
import {
  BanGlyph,
  BriefcaseGlyph,
  CalendarGlyph,
  CalendarOffGlyph,
  ChevronDown,
  Close,
  GearGlyph,
  LockGlyph,
  Minus,
  MoonGlyph,
  Plus,
  PointerGlyph,
  SunriseGlyph,
  TouchGlyph,
  Undo,
  UnlockGlyph,
} from "@/components/ui/icons";
import { keyboardFocused } from "@/components/ui/input-source";
import { Segmented } from "@/components/ui/Segmented";
import { Slider } from "@/components/ui/Slider";
import { Switch } from "@/components/ui/Switch";
import type { Section } from "@/lib/sections";
import type { SchedulePreferences } from "@/lib/types";
import { CalendarFeeds } from "./CalendarFeeds";
import type { BuilderCalendars, WeekCourse } from "./host";
import {
  CARD_SIZE,
  CreditPic,
  LEAN_PIC,
} from "./pictures";
import {
  LEAN_ORDER,
  LEANS,
  leanOf,
  leanSays,
  leanValue,
  ledger,
  moreChanged,
  renameBusy,
  stepCredits,
  walkSays,
  WALK_BUFFERS,
  withHours,
  withLean,
  type LeanKey,
  type LedgerRow,
} from "./limits";
import { PaintGrid } from "./PaintGrid";
import { removeBusy } from "./preferences";
import styles from "./prefs.module.css";
import { patternOf, sectionLabel } from "./week";

type Update = (update: (current: SchedulePreferences) => SchedulePreferences) => void;

export type PreferencesContentProps = {
  preferences: SchedulePreferences;
  defaults: SchedulePreferences;
  onChange: Update;
  newId: () => string;
  /** The courses on the week, for locks, skips and the credit limit. */
  courses: readonly WeekCourse[];
  onKeep: (courseCode: string, kept: boolean) => void;
  options: (courseCode: string) => readonly Section[] | null;
  load: (courseCodes: readonly string[]) => void;
  touch: boolean;
  /** Calendar feeds as busy time; null where the host can't connect them. */
  calendars: BuilderCalendars | null;
};

/* ───────── Times you can't have class ───────── */

const ROW_ICON: Record<LedgerRow["kind"], ReactNode> = {
  start: <SunriseGlyph size={16} />,
  end: <MoonGlyph size={16} />,
  off: <CalendarOffGlyph size={16} />,
  busy: <BriefcaseGlyph size={16} />,
};

function Ledger({ preferences: p, onChange }: Pick<PreferencesContentProps, "preferences" | "onChange">) {
  const rows = ledger(p);
  if (rows.length === 0) return <p className={styles.ledgerEmpty}>Nothing blocked. Auto may use any weekday time.</p>;
  const clear = (row: LedgerRow): ((q: SchedulePreferences) => SchedulePreferences) => {
    if (row.kind === "start") return (q) => withHours(q, "start", 0);
    if (row.kind === "end") return (q) => withHours(q, "end", 24 * 60);
    if (row.kind === "off") return (q) => ({ ...q, constraints: { ...q.constraints, daysOff: [] } });
    return (q) => removeBusy(q, row.ids);
  };
  return (
    <ul className={styles.ledger}>
      {rows.map((row) => (
        <li key={row.kind === "busy" ? row.ids.join() : row.kind}>
          <span className={styles.rowIcon}>{row.kind === "busy" && row.dated ? <CalendarGlyph size={16} /> : ROW_ICON[row.kind]}</span>
          <span className={styles.rowText}>
            {row.kind === "busy" && row.unnamed ? (
              <NameField ids={row.ids} onChange={onChange} />
            ) : (
              <b>{row.title}</b>
            )}
            {row.kind === "busy" ? <span>{row.detail}</span> : null}
          </span>
          <IconButton label={`Remove ${row.kind === "busy" ? `${row.title}, ${row.detail}` : row.title}`} size="sm" className={styles.rowX} onClick={() => onChange(clear(row))}>
            <Close size={14} />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

/** A painted block starts unnamed; naming it here gives the grid and the ledger a word for it. */
function NameField({ ids, onChange }: { ids: string[]; onChange: Update }) {
  const [value, setValue] = useState("");
  const save = () => {
    if (value.trim()) onChange((q) => renameBusy(q, ids, value));
  };
  return (
    <input
      className={styles.nameField}
      aria-label="Name this busy time"
      placeholder="Name it, such as Work"
      value={value}
      maxLength={24}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          save();
        }
      }}
    />
  );
}

/* ───────── Leanings ───────── */

function Leanings({ preferences: p, onChange, touch }: Pick<PreferencesContentProps, "preferences" | "onChange" | "touch">) {
  const [open, setOpen] = useState<LeanKey | null>(null);
  const wellId = useId();
  const cards = useRef<HTMLDivElement>(null);
  const close = () => {
    const was = open;
    setOpen(null);
    if (was) cards.current?.querySelector<HTMLElement>(`[data-lean="${was}"]`)?.focus();
  };
  const shown = open ?? null;
  const lean = shown ? LEANS[shown] : null;
  const value = shown ? leanOf(p.weights, shown) : 0;
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          event.preventDefault();
          close();
        }
      }}
    >
      <div className={styles.cards} ref={cards} role="group" aria-label="Leanings">
        {LEAN_ORDER.map((key) => {
          const v = leanOf(p.weights, key);
          const [w, h] = CARD_SIZE[key];
          const Pic = LEAN_PIC[key];
          return (
            <button
              key={key}
              type="button"
              className={styles.card}
              data-lean={key}
              data-wide={key === "time" ? "" : undefined}
              aria-expanded={open === key}
              aria-controls={wellId}
              onClick={() => setOpen(open === key ? null : key)}
            >
              <span className={styles.cardPic}>
                <Pic v={v} w={key === "time" && touch ? 190 : w} h={h} />
              </span>
              <span>
                <b>{LEANS[key].title}</b>
                <span className={styles.cardValue}>{leanValue(key, v)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className={styles.wellWrap} data-open={open ? "" : undefined} inert={!open}>
        <div>
          <div className={styles.well} id={wellId} role="region" aria-label={lean?.title ?? "Leaning"}>
            {shown && lean ? (
              <>
                <div className={styles.wellHead}>
                  <b>{lean.title}</b>
                  <IconButton label={`Close ${lean.title}`} size="sm" onClick={close}>
                    <Close size={14} />
                  </IconButton>
                </div>
                <div className={styles.slideRow}>
                  <span className={styles.endPic} data-on={value === lean.min ? "" : undefined}>
                    {shown === "time" ? <SunriseGlyph size={22} /> : LEAN_PIC[shown]({ v: 0, w: 30, h: 30, tint: false })}
                  </span>
                  <Slider
                    label={shown === "time" ? "Lean" : "How much it matters"}
                    min={lean.min}
                    max={lean.max}
                    ticks
                    value={value}
                    formatValue={(v) => leanValue(shown, v)}
                    minLabel={lean.ends[0]}
                    maxLabel={lean.ends[1]}
                    onValueChange={(v) => onChange((q) => withLean(q, shown, v))}
                    className={styles.slider}
                  />
                  <span className={styles.endPic} data-on={value === lean.max ? "" : undefined}>
                    {shown === "time" ? <MoonGlyph size={22} /> : LEAN_PIC[shown]({ v: 4, w: 30, h: 30, tint: false })}
                  </span>
                </div>
                <p className={styles.says} aria-live="polite">
                  {leanSays(shown, value)}
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── Courses and sections ───────── */

function CourseSettings(props: PreferencesContentProps) {
  const { preferences: p, onChange, courses } = props;
  const c = p.constraints;
  const planned = courses.reduce((sum, course) => sum + course.credits, 0);
  const over = c.maxCredits !== null && planned > c.maxCredits;
  const locked = courses.filter((course) => course.locked && course.section);
  const [picking, setPicking] = useState<"lock" | "skip" | null>(null);
  const [course, setCourse] = useState<string | null>(null);
  const { load } = props;
  const codes = courses.map((x) => x.code).join("|");
  // Skipped sections are named by their course's options, so load them once the section shows.
  useEffect(() => {
    if (c.excludedSections.length > 0 || picking === "skip") load(codes.split("|").filter(Boolean));
  }, [c.excludedSections.length, picking, codes, load]);
  type Skip = { id: string; code: string | null; section: Section | null };
  const skipped = c.excludedSections.map((id): Skip => {
    for (const x of courses) {
      const s = props.options(x.code)?.find((o) => o.id === id);
      if (s) return { id, code: x.code, section: s };
    }
    return { id, code: null, section: null };
  });

  const startPick = (kind: "lock" | "skip") => {
    setPicking(picking === kind ? null : kind);
    setCourse(null);
  };
  const choices = picking === "lock" ? courses.filter((x) => x.section && !x.locked) : courses;
  const sections = picking === "skip" && course ? (props.options(course) ?? null) : null;

  return (
    <div>
      <div className={styles.creditRow}>
        <span className={styles.creditPic}>
          <CreditPic planned={planned} max={c.maxCredits} />
        </span>
        <span className={styles.rowText}>
          <b aria-live="polite">{c.maxCredits === null ? "No credit limit" : `At most ${c.maxCredits} credits`}</b>
          <span data-over={over ? "" : undefined}>
            {over ? `Your week has ${planned}. Auto will leave a class out.` : `Your week has ${planned}.${planned < 12 ? " Full-time starts at 12." : ""}`}
          </span>
        </span>
        <span className={styles.stepper} role="group" aria-label="Credit limit">
          <IconButton label="Lower the credit limit" size="sm" disabled={c.maxCredits === 3} onClick={() => onChange((q) => ({ ...q, constraints: { ...q.constraints, maxCredits: stepCredits(q.constraints.maxCredits, -1) } }))}>
            <Minus size={15} />
          </IconButton>
          <IconButton label="Raise the credit limit" size="sm" disabled={c.maxCredits === null} onClick={() => onChange((q) => ({ ...q, constraints: { ...q.constraints, maxCredits: stepCredits(q.constraints.maxCredits, 1) } }))}>
            <Plus size={15} />
          </IconButton>
        </span>
      </div>

      <div className={styles.subHead}>
        <span>Locked sections</span>
        <button type="button" className={styles.add} aria-expanded={picking === "lock"} onClick={() => startPick("lock")}>
          <Plus size={14} />
          Lock a section
        </button>
      </div>
      {locked.length === 0 ? (
        <p className={styles.srowEmpty}>None. Auto may pick any section of every course.</p>
      ) : (
        <ul className={styles.srows}>
          {locked.map((x) => (
            <li key={x.code} data-kind="lock">
              <span className={styles.rowIcon}>
                <LockGlyph size={16} />
              </span>
              <span className={styles.rowText}>
                <b>
                  <span className={styles.code}>{x.code}</span>, section {sectionLabel(x.section!)}
                </b>
                <span>{patternOf(x.section!)}</span>
              </span>
              <IconButton label={`Unlock ${x.code}`} size="sm" className={styles.rowX} onClick={() => props.onKeep(x.code, false)}>
                <UnlockGlyph size={16} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {picking === "lock" ? (
        <div className={styles.picker} role="group" aria-label="Lock a section">
          <p className={styles.pickerHead}>Keep the section on your week for</p>
          {choices.length === 0 ? (
            <p className={styles.srowEmpty}>Every course on your week is locked or has no section yet.</p>
          ) : (
            <div className={styles.chips}>
              {choices.map((x) => (
                <button
                  key={x.code}
                  type="button"
                  className={styles.chip}
                  onClick={() => {
                    props.onKeep(x.code, true);
                    setPicking(null);
                  }}
                >
                  <span className={styles.code}>{x.code}</span>
                  <span className={styles.chipMeta}>{sectionLabel(x.section!)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className={styles.subHead}>
        <span>Skipped sections</span>
        <button type="button" className={styles.add} aria-expanded={picking === "skip"} onClick={() => startPick("skip")}>
          <Plus size={14} />
          Skip a section
        </button>
      </div>
      {skipped.length === 0 ? (
        <p className={styles.srowEmpty}>None. Auto may pick any section that fits.</p>
      ) : (
        <ul className={styles.srows}>
          {skipped.map((s) => (
            <li key={s.id}>
              <span className={styles.rowIcon}>
                <BanGlyph size={16} />
              </span>
              <span className={styles.rowText}>
                <b>{s.code && s.section ? <><span className={styles.code}>{s.code}</span>, section {sectionLabel(s.section)}</> : "A section not offered this term"}</b>
                {s.section ? <span>{patternOf(s.section)}</span> : null}
              </span>
              <IconButton
                label={`Stop skipping ${s.code ?? "this section"}`}
                size="sm"
                className={styles.rowX}
                onClick={() => onChange((q) => ({ ...q, constraints: { ...q.constraints, excludedSections: q.constraints.excludedSections.filter((id) => id !== s.id) } }))}
              >
                <Close size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {picking === "skip" ? (
        <div className={styles.picker} role="group" aria-label="Skip a section">
          <p className={styles.pickerHead}>Skip a section of</p>
          <div className={styles.chips}>
            {courses.map((x) => (
              <button key={x.code} type="button" className={styles.chip} aria-pressed={course === x.code} onClick={() => setCourse(x.code)}>
                <span className={styles.code}>{x.code}</span>
              </button>
            ))}
          </div>
          {course && sections === null ? <p className={styles.srowEmpty}>Loading sections.</p> : null}
          {sections?.map((s) => {
            const skippedNow = c.excludedSections.includes(s.id);
            const onWeek = courses.find((x) => x.code === course)?.section?.id === s.id;
            return (
              <button
                key={s.id}
                type="button"
                className={styles.opt}
                disabled={skippedNow}
                onClick={() => {
                  onChange((q) => ({ ...q, constraints: { ...q.constraints, excludedSections: [...q.constraints.excludedSections, s.id] } }));
                  setPicking(null);
                }}
              >
                <span className={styles.rowText}>
                  <b>Section {sectionLabel(s)}</b>
                  <span>{patternOf(s)}</span>
                </span>
                <span className={styles.optTag}>{skippedNow ? "Skipped" : onWeek ? "On your week" : ""}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ───────── More settings ───────── */

function More({ preferences: p, defaults, onChange }: Pick<PreferencesContentProps, "preferences" | "defaults" | "onChange">) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const n = moreChanged(p, defaults);
  const c = p.constraints;
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    <div className={styles.more}>
      <button
        ref={toggle}
        type="button"
        className={styles.moreToggle}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) window.setTimeout(() => toggle.current?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 60);
        }}
      >
        <GearGlyph size={18} />
        <span>More settings</span>
        {n > 0 ? <span className={styles.moreCount}>{n} changed</span> : null}
        <ChevronDown size={16} className={styles.chev} />
      </button>
      <div className={styles.moreBody} id={id} data-open={open ? "" : undefined} inert={!open}>
        <div>
          <div className={styles.moreIn}>
            <div className={styles.walkRow}>
              <b id={`${id}-walk`}>Time to walk between classes</b>
              <span>{walkSays(c.walkingBufferMinutes)}</span>
              <Segmented
                label="Time to walk between classes"
                size="sm"
                fullWidth
                options={WALK_BUFFERS.map((w) => ({ value: String(w.value), label: w.label }))}
                value={String(c.walkingBufferMinutes)}
                onValueChange={(v) => onChange((q) => ({ ...q, constraints: { ...q.constraints, walkingBufferMinutes: v === "null" ? null : Number(v) } }))}
              />
            </div>
            <Switch
              checked={c.openSeatsOnly}
              onChange={(on) => onChange((q) => ({ ...q, constraints: { ...q.constraints, openSeatsOnly: on } }))}
              label="Open seats only"
              description="Auto suggests only sections with a seat open. Full and wait-listed ones stay pickable by hand."
            />
            <Switch
              checked={c.otherSites}
              onChange={(on) => onChange((q) => ({ ...q, constraints: { ...q.constraints, otherSites: on } }))}
              label="Include other UNT sites"
              description="Frisco and other campuses outside Denton. Discovery Park counts as Denton."
            />
            <div className={styles.resetRow}>
              <span>Clears your times, leanings and credit limit. Locked and skipped sections and your calendars stay.</span>
              <Button
                variant="quiet"
                size="sm"
                icon={<Undo size={16} />}
                onClick={() =>
                  onChange((q) => ({
                    ...defaults,
                    constraints: { ...defaults.constraints, excludedSections: q.constraints.excludedSections },
                    ...(q.calendars ? { calendars: q.calendars } : {}),
                  }))
                }
              >
                Back to defaults
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── The panel ───────── */

/** Hard limits, then leanings, then settings about specific classes, then More (r3 mockup). */
export function PreferencesContent(props: PreferencesContentProps) {
  const { touch } = props;
  return (
    <>
      <section className={styles.sec} aria-labelledby="pref-times">
        <h3 id="pref-times">Times you can&apos;t have class</h3>
        <p className={styles.secSub}>Auto never puts a class here.</p>
        <p className={styles.hint}>
          {touch ? <TouchGlyph size={14} /> : <PointerGlyph size={14} />}
          <span>
            {touch
              ? "Tap a half hour, or press and hold, then drag. Tap a day to take it off. Drag the sun and moon to set your class hours."
              : "Drag over times you can't do. Click a day to take it off. Drag the sun and moon to set your class hours."}
          </span>
        </p>
        <PaintGrid preferences={props.preferences} onChange={props.onChange} newId={props.newId} touch={touch} />
        <Ledger preferences={props.preferences} onChange={props.onChange} />
        {props.calendars ? <CalendarFeeds host={props.calendars} preferences={props.preferences} onChange={props.onChange} /> : null}
      </section>
      <section className={styles.sec} aria-labelledby="pref-lean">
        <h3 id="pref-lean">Leanings</h3>
        <p className={styles.secSub}>Auto follows these when it can. {touch ? "Tap" : "Open"} one to change how much it matters.</p>
        <Leanings preferences={props.preferences} onChange={props.onChange} touch={touch} />
      </section>
      <section className={styles.sec} aria-labelledby="pref-courses">
        <h3 id="pref-courses">Courses and sections</h3>
        <p className={styles.secSub}>Settings for specific classes on your week.</p>
        <CourseSettings {...props} />
      </section>
      <More preferences={props.preferences} defaults={props.defaults} onChange={props.onChange} />
    </>
  );
}

/* ───────── The shells: a popover on desktop, a sheet on phones ───────── */

type ShellProps = PreferencesContentProps & {
  open: boolean;
  onClose: () => void;
  /** The Preferences button: the popover hangs from it and focus returns to it. */
  anchor: () => HTMLElement | null;
  phone: boolean;
  ready: boolean;
};

const EXIT_MS = 140;

/**
 * Preferences, anchored to its button in Week's top bar. Desktop: a
 * non-modal popover that scales in from the button, so the week behind it
 * stays visible and updates as preferences change; Escape, × or a click
 * outside closes it. Phones: the app's bottom sheet. Opened or closed from
 * the keyboard, nothing animates; under reduced motion it only fades.
 */
export function PreferencesPopover(props: ShellProps) {
  const { open, onClose, anchor, phone, ready } = props;
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [instant, setInstant] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number; nub: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  if (open && !mounted) setMounted(true);
  // Opening or closing: read the input source once, at the change (ContextPanel does the same).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setShown(false);
    if (open) setInstant(keyboardFocused());
  }

  // Position under the button, right-aligned to it, and re-measure on resize.
  useLayoutEffect(() => {
    if (!mounted || phone) return;
    const place = () => {
      const a = anchor()?.getBoundingClientRect();
      if (!a) return;
      const right = Math.max(16, window.innerWidth - a.right);
      setPos({ top: a.bottom + 10, right, nub: window.innerWidth - right - (a.left + a.width / 2) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [mounted, phone, anchor]);

  // Enter on the next frame so the transition runs; exit, then unmount.
  useEffect(() => {
    if (phone) return;
    if (open) {
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    const t = window.setTimeout(() => setMounted(false), keyboardFocused() ? 0 : EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open, phone]);

  // Focus the heading on open; Escape and outside clicks close.
  useEffect(() => {
    if (!open || phone) return;
    heading.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setInstant(true);
      onClose();
      anchor()?.focus();
    };
    const onDown = (event: PointerEvent) => {
      const t = event.target as Node;
      if (panel.current?.contains(t) || anchor()?.contains(t)) return;
      // Toasts (Undo) sit above everything and shouldn't close it.
      if ((t as HTMLElement).closest?.(".ui-toast")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, phone, onClose, anchor]);

  const head = (
    <div className={styles.head} data-scrolled={scrolled ? "" : undefined}>
      <div>
        <h2 ref={heading} tabIndex={-1}>
          Preferences
        </h2>
        <p>Auto builds your week around these.</p>
      </div>
      <IconButton
        label="Close preferences"
        size="sm"
        onClick={(event) => {
          if (event.detail === 0) setInstant(true);
          onClose();
          anchor()?.focus();
        }}
      >
        <Close size={16} />
      </IconButton>
    </div>
  );
  const body = ready ? <PreferencesContent {...props} /> : <p className={styles.secSub}>Loading your preferences.</p>;

  if (phone) {
    return (
      <BottomSheet open={open} onOpenChange={(o) => (o ? null : onClose())} title="Preferences" detents={["92%"]} returnFocus={anchor} header={head} className={styles.sheet}>
        <div className={styles.sheetBody}>{body}</div>
      </BottomSheet>
    );
  }
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panel}
      className={styles.pop}
      role="dialog"
      aria-modal="false"
      aria-label="Preferences"
      data-shown={shown && open ? "" : undefined}
      data-instant={instant ? "" : undefined}
      style={pos ? { top: pos.top, right: pos.right, maxHeight: `calc(100dvh - ${pos.top + 16}px)`, ["--nub" as string]: `${pos.nub}px` } : { visibility: "hidden" }}
    >
      <span className={styles.nub} aria-hidden="true" />
      {head}
      <div ref={scroller} className={styles.scroll} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}>
        {body}
      </div>
    </div>,
    document.body,
  );
}
