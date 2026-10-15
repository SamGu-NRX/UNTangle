"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ChevronLeft, Close, PointerGlyph, TouchGlyph } from "@/components/ui/icons";
import { keyboardFocused } from "@/components/ui/input-source";
import { Slider } from "@/components/ui/Slider";
import { useMediaQuery } from "@/components/ui/use-media-query";
import type { SchedulePreferences } from "@/lib/types";
import { CARD_SIZE, LEAN_PIC } from "./pictures";
import { LEAN_ORDER, LEANS, leanOf, leanValue, ledger, withLean, type LeanKey } from "./limits";
import { PaintGrid } from "./PaintGrid";
import { Ledger, ROW_ICON } from "./PreferencesPopover";
import prefs from "./prefs.module.css";
import { autoSays, CHAPTERS, QUESTION_COUNT, QUESTIONS, SETUP_STEPS, skipStep, type QuestionKey, type SetupStep } from "./setup";
import styles from "./setup.module.css";

type Update = (update: (current: SchedulePreferences) => SchedulePreferences) => void;

export type SetupClose = {
  /** Finished from Ready, rather than skipped, closed or swiped away. */
  finished: boolean;
  fromKeyboard: boolean;
  /** The preferences when the setup opened, for Undo. */
  before: SchedulePreferences;
};

type Props = {
  open: boolean;
  /**
   * "first": nothing is checked until the student picks it. "again" (opened
   * from Preferences): each question shows the answer Auto follows now.
   */
  mode: "first" | "again";
  preferences: SchedulePreferences;
  onChange: Update;
  newId: () => string;
  /** Ready's button builds the week (runs Auto) when there is a course to place. */
  canBuild: boolean;
  phone: boolean;
  touch: boolean;
  onClose: (how: SetupClose) => void;
  returnFocus?: () => HTMLElement | null;
};

const LAST = SETUP_STEPS.length - 1;
const QUESTION_KEYS = SETUP_STEPS.flatMap((s) => (s.kind === "question" ? [s.key] : []));

/** A question's picture, larger than its Preferences card (the mockup's sizes). Phones draw it at .86. */
const BIG: Record<QuestionKey, [number, number]> = { time: [300, 104], fewerDays: [210, 110], walking: [200, 110], rating: [240, 70] };

/* ───────── The picture glides between answers ───────── */

/** --t-move: the picture moves on screen in answer to a choice. */
const GLIDE_MS = 300;

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of progress, solved by Newton's method. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  return (p: number) => {
    let t = p;
    for (let i = 0; i < 8; i++) {
      const err = x(t) - p;
      const slope = dx(t);
      if (Math.abs(err) < 1e-5 || Math.abs(slope) < 1e-6) break;
      t -= err / slope;
    }
    return y(Math.min(1, Math.max(0, t)));
  };
}
/** --ease-out, the curve for a response. */
const easeOut = cubicBezier(0.23, 1, 0.32, 1);

/**
 * The value a picture draws: it glides to `target` over GLIDE_MS when
 * `glide` is on, and jumps there otherwise (a keyboard choice, reduced
 * motion). A new target mid-glide starts from where the picture is.
 */
function useGlide(target: number, glide: boolean): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const moves = glide && !reduced;
  useEffect(() => {
    const from = current.current;
    if (from === target) return;
    if (!moves) {
      current.current = target;
      return;
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const p = Math.min(1, (now - t0) / GLIDE_MS);
      current.current = from + (target - from) * easeOut(p);
      setShown(current.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, moves]);
  return moves ? shown : target;
}

/* ───────── Progress: one segment per step, a wider gap between chapters ───────── */

function Progress({ index, skipped, instant }: { index: number; skipped: ReadonlySet<number>; instant: boolean }) {
  const step = SETUP_STEPS[index];
  return (
    <div
      className={styles.progress}
      role="progressbar"
      aria-label="Setup progress"
      aria-valuemin={1}
      aria-valuemax={SETUP_STEPS.length}
      aria-valuenow={index + 1}
      aria-valuetext={`${CHAPTERS[step.chapter]}, step ${index + 1} of ${SETUP_STEPS.length}`}
      data-instant={instant ? "" : undefined}
    >
      {CHAPTERS.map((chapter, c) => {
        const members = SETUP_STEPS.map((s, i) => ({ s, i })).filter(({ s }) => s.chapter === c);
        return (
          <span key={chapter} className={styles.chapter} style={{ flexGrow: members.length }}>
            {members.map(({ i }) => (
              <i key={i} data-state={i < index ? (skipped.has(i) ? "skipped" : "done") : i === index ? "on" : undefined} />
            ))}
          </span>
        );
      })}
    </div>
  );
}

/* ───────── What matters most: one question, a picture over its answers ───────── */

type QuestionProps = {
  questionKey: QuestionKey;
  /** The answer Auto follows now. */
  value: number;
  picked: boolean;
  onPick: (value: number) => void;
  /** Enter on the checked answer: Continue, so a keyboard user never has to tab to it. */
  onContinue: () => void;
  phone: boolean;
  /** A fine pointer that hovers: hovering an answer previews its picture. */
  hover: boolean;
  heading: RefObject<HTMLHeadingElement | null>;
  headingId: string;
};

function QuestionPane({ questionKey: k, value, picked, onPick, onContinue, phone, hover: canHover, heading, headingId }: QuestionProps) {
  const q = QUESTIONS[k];
  const n = QUESTION_KEYS.indexOf(k) + 1;
  const [hover, setHover] = useState<number | null>(null);
  const [glide, setGlide] = useState(true);
  const target = hover ?? value;
  const shown = useGlide(target, glide);
  const Pic = LEAN_PIC[k];
  const [w, h] = BIG[k];
  const scale = phone ? 0.86 : 1;
  const answers = useRef<Array<HTMLButtonElement | null>>([]);
  const checked = picked ? q.answers.findIndex((a) => a.value === value) : -1;

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const by = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (by !== undefined) {
      event.preventDefault();
      const next = Math.max(0, Math.min(q.answers.length - 1, (checked < 0 ? i : checked) + by));
      setGlide(false);
      onPick(q.answers[next].value);
      answers.current[next]?.focus();
    } else if (event.key === "Enter" && i === checked) {
      event.preventDefault();
      onContinue();
    }
  };

  return (
    <>
      <p className={styles.eyebrow}>
        {CHAPTERS[0]}, {n} of {QUESTION_COUNT}
      </p>
      <h2 ref={heading} id={headingId} tabIndex={-1} className={styles.title}>
        {q.question}
      </h2>
      {q.sub ? <p className={styles.lede}>{q.sub}</p> : null}
      <div className={styles.picbox} aria-hidden="true">
        <Pic v={shown} w={Math.round(w * scale)} h={Math.round(h * scale)} labels={k === "time"} />
      </div>
      <p className={styles.say} data-idle={picked || hover !== null ? undefined : ""} aria-live="polite">
        {picked || hover !== null ? autoSays(k, target) : "Pick an answer to see what Auto does with it."}
      </p>
      <div className={styles.answers} role="radiogroup" aria-labelledby={headingId} onPointerLeave={() => setHover(null)}>
        {q.answers.map((a, i) => (
          <button
            key={a.value}
            ref={(el) => {
              answers.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={i === checked}
            // One stop for the group: the checked answer, or the first before one is picked.
            tabIndex={i === (checked < 0 ? 0 : checked) ? 0 : -1}
            className={styles.answer}
            onPointerEnter={(event) => {
              if (!canHover || event.pointerType !== "mouse") return;
              setGlide(true);
              setHover(a.value);
            }}
            onClick={(event) => {
              setGlide(event.detail !== 0);
              onPick(a.value);
            }}
            onKeyDown={(event) => onKey(event, i)}
          >
            <span className={styles.dot} aria-hidden="true" />
            {a.label}
          </button>
        ))}
      </div>
    </>
  );
}

/* ───────── Shape of your days: the Preferences grid, then short gaps ───────── */

type ShapeProps = { preferences: SchedulePreferences; onChange: Update; newId: () => string; touch: boolean; heading: RefObject<HTMLHeadingElement | null>; headingId: string };

function ShapePane({ preferences: p, onChange, newId, touch, heading, headingId }: ShapeProps) {
  const lean = LEANS.compact;
  const v = leanOf(p.weights, "compact");
  return (
    <>
      <p className={styles.eyebrow}>{CHAPTERS[1]}</p>
      <h2 ref={heading} id={headingId} tabIndex={-1} className={styles.title}>
        When can you have class?
      </h2>
      <p className={styles.lede}>Auto never puts a class in hatched time.</p>
      {/* The same grid, hint and list as Preferences, so the student meets them there already known. */}
      <p className={prefs.hint}>
        {touch ? <TouchGlyph size={14} /> : <PointerGlyph size={14} />}
        <span>
          {touch
            ? "Tap a half hour, or press and hold, then drag. Tap a day to take it off. Drag the sun and moon to set your class hours."
            : "Drag over times you can't do. Click a day to take it off. Drag the sun and moon to set your class hours."}
        </span>
      </p>
      <PaintGrid preferences={p} onChange={onChange} newId={newId} touch={touch} />
      <Ledger preferences={p} onChange={onChange} />
      <div className={styles.gaps}>
        <p className={styles.gapsLabel} aria-hidden="true">
          Time between classes
        </p>
        <div className={prefs.slideRow}>
          <span className={prefs.endPic} data-on={v === lean.min ? "" : undefined}>
            {LEAN_PIC.compact({ v: 0, w: 30, h: 30, tint: false })}
          </span>
          <Slider
            label="Time between classes"
            min={lean.min}
            max={lean.max}
            ticks
            value={v}
            formatValue={(x) => leanValue("compact", x)}
            minLabel={lean.ends[0]}
            maxLabel={lean.ends[1]}
            onValueChange={(x) => onChange((q) => withLean(q, "compact", x))}
            className={prefs.slider}
          />
          <span className={prefs.endPic} data-on={v === lean.max ? "" : undefined}>
            {LEAN_PIC.compact({ v: 4, w: 30, h: 30, tint: false })}
          </span>
        </div>
        <p className={prefs.says} aria-live="polite">
          {autoSays("compact", v)}
        </p>
      </div>
    </>
  );
}

/* ───────── Ready: what Auto will follow, as Preferences shows it ───────── */

type ReadyProps = { preferences: SchedulePreferences; onEdit: (key: LeanKey) => void; heading: RefObject<HTMLHeadingElement | null>; headingId: string; touch: boolean };

function ReadyPane({ preferences: p, onEdit, heading, headingId, touch }: ReadyProps) {
  const rows = ledger(p);
  return (
    <>
      <p className={styles.eyebrow}>{CHAPTERS[2]}</p>
      <h2 ref={heading} id={headingId} tabIndex={-1} className={styles.title}>
        What Auto will follow
      </h2>
      <p className={styles.lede}>Change any of these later in Preferences.</p>
      <h3 className={styles.subHead}>Leanings</h3>
      <div className={prefs.cards}>
        {LEAN_ORDER.map((key) => {
          const v = leanOf(p.weights, key);
          const [w, h] = CARD_SIZE[key];
          const Pic = LEAN_PIC[key];
          return (
            <button key={key} type="button" className={prefs.card} data-wide={key === "time" ? "" : undefined} aria-label={`Change ${LEANS[key].title}, now ${leanValue(key, v)}`} onClick={() => onEdit(key)}>
              <span className={prefs.cardPic}>
                <Pic v={v} w={key === "time" && touch ? 190 : w} h={h} />
              </span>
              <span>
                <b>{LEANS[key].title}</b>
                <span className={prefs.cardValue}>{leanValue(key, v)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <h3 className={styles.subHead}>Times you can&apos;t have class</h3>
      {rows.length === 0 ? (
        <p className={styles.none}>Nothing blocked. Auto may use any weekday time.</p>
      ) : (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.kind === "busy" ? row.ids.join() : row.kind}>
              <span className={prefs.rowIcon}>{ROW_ICON[row.kind]}</span>
              <span className={prefs.rowText}>
                <b>{row.title}</b>
                {row.kind === "busy" ? <span>{row.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ───────── The shell: a dialog on desktop, a sheet on phones ───────── */

/**
 * "Set up Auto" (r3 mockup, onboarding.html): a short, optional pop-in that
 * asks what matters, then the shape of the student's days, and shows what
 * Auto will follow. Every answer is written at once through `onChange`, the
 * same preferences Week and Auto read, so the week behind it updates as
 * the student answers. Skipping a step puts its fields back as they were
 * when the setup opened. Desktop: a centred dialog; phones: a sheet.
 * Moving between steps slides 14px in the direction of travel; from the
 * keyboard nothing moves, and under reduced motion it only fades.
 */
export function SetupAuto(props: Props) {
  const { open, mode, preferences: p, onChange, newId, canBuild, phone, touch, onClose, returnFocus } = props;
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [instant, setInstant] = useState(true);
  const [picked, setPicked] = useState<ReadonlySet<QuestionKey>>(new Set());
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  const [before, setBefore] = useState(p);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const nameId = useId();
  /** Set by a move between steps: the new step's heading takes focus once it renders. */
  const moved = useRef(false);

  // Each opening starts over from what the preferences are now.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setIndex(0);
      setDir("forward");
      setInstant(true);
      setPicked(new Set(mode === "again" ? QUESTION_KEYS : []));
      setSkipped(new Set());
      setBefore(p);
    }
  }

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const h = heading.current;
    h?.closest(".ui-dialog__body, .ui-sheet__body")?.scrollTo({ top: 0 });
    h?.focus({ preventScroll: true });
  }, [index]);

  const step: SetupStep = SETUP_STEPS[index];
  const go = (to: number, fromKeyboard: boolean) => {
    moved.current = true;
    setDir(to > index ? "forward" : "back");
    setInstant(fromKeyboard);
    setIndex(Math.max(0, Math.min(LAST, to)));
  };
  const without = <T,>(set: ReadonlySet<T>, x: T) => new Set([...set].filter((y) => y !== x));
  const finish = (fromKeyboard: boolean) => onClose({ finished: true, fromKeyboard, before });
  const dismiss = () => onClose({ finished: false, fromKeyboard: keyboardFocused(), before });
  const next = (fromKeyboard: boolean) => {
    if (index === LAST) return finish(fromKeyboard);
    setSkipped(without(skipped, index));
    go(index + 1, fromKeyboard);
  };
  const skip = (fromKeyboard: boolean) => {
    onChange((q) => skipStep(q, before, step));
    if (step.kind === "question") setPicked(without(picked, step.key));
    setSkipped(new Set([...skipped, index]));
    go(index + 1, fromKeyboard);
  };
  const edit = (key: LeanKey) => {
    const to = key === "compact" ? SETUP_STEPS.findIndex((s) => s.kind === "shape") : SETUP_STEPS.findIndex((s) => s.kind === "question" && s.key === key);
    go(to, keyboardFocused());
  };

  const canContinue = step.kind !== "question" || picked.has(step.key);
  const pane = (
    <div key={index} className={styles.pane} data-dir={dir} data-instant={instant ? "" : undefined}>
      {step.kind === "question" ? (
        <QuestionPane
          questionKey={step.key}
          value={leanOf(p.weights, step.key)}
          picked={picked.has(step.key)}
          onPick={(value) => {
            const key = step.key;
            setPicked(new Set([...picked, key]));
            onChange((q) => withLean(q, key, value));
          }}
          onContinue={() => next(true)}
          phone={phone}
          hover={!touch}
          heading={heading}
          headingId={headingId}
        />
      ) : step.kind === "shape" ? (
        <ShapePane preferences={p} onChange={onChange} newId={newId} touch={touch} heading={heading} headingId={headingId} />
      ) : (
        <ReadyPane preferences={p} onEdit={edit} heading={heading} headingId={headingId} touch={touch} />
      )}
    </div>
  );

  const foot = (
    <div className={styles.foot}>
      <IconButton label="Back" className={styles.back} data-hidden={index === 0 ? "" : undefined} disabled={index === 0} onClick={(event) => go(index - 1, event.detail === 0)}>
        <ChevronLeft size={20} />
      </IconButton>
      <span className={styles.grow} />
      {step.kind === "ready" ? null : (
        <Button variant="ink" onClick={(event) => skip(event.detail === 0)}>
          {step.kind === "question" ? "Skip this question" : "Skip this step"}
        </Button>
      )}
      <Button disabled={!canContinue} onClick={(event) => next(event.detail === 0)}>
        {step.kind !== "ready" ? "Continue" : canBuild ? "Build my week" : "Done"}
      </Button>
    </div>
  );
  const progress = <Progress index={index} skipped={skipped} instant={instant} />;

  if (phone) {
    return (
      <BottomSheet
        open={open}
        onOpenChange={(o) => (o ? null : dismiss())}
        title="Set up Auto"
        returnFocus={returnFocus}
        initialFocus={heading}
        className={styles.sheet}
        header={
          <div className={styles.sheetHead}>
            {progress}
            <IconButton label="Skip setup" size="sm" onClick={dismiss}>
              <Close size={16} />
            </IconButton>
          </div>
        }
      >
        <div className={styles.sheetFlow}>
          <div className={styles.sheetBody}>{pane}</div>
          {foot}
        </div>
      </BottomSheet>
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? null : dismiss())}
      title={
        <div className={styles.head}>
          <span id={nameId} className="sr-only-v2">
            Set up Auto
          </span>
          {progress}
        </div>
      }
      labelledBy={nameId}
      width={580}
      initialFocus={heading}
      returnFocus={returnFocus}
      footer={foot}
      className={styles.dialog}
    >
      {pane}
    </Dialog>
  );
}
