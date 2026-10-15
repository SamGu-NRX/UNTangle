/*
 * The leaning cards' pictures (r3 mockup, preferences.html): each draws its
 * current value, so a card reads at a glance without its label. `tint` uses
 * the course hues for a card face; without it the picture draws in
 * currentColor, for the slider's two ends, which light up as you lean.
 * All are decorative; the card or slider around them carries the name.
 */
import type { ReactElement } from "react";
import type { LeanKey } from "./limits";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Piecewise-linear over integer stops. */
const at = (v: number, pts: number[]) => {
  const x = clamp(v, 0, pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(x));
  return lerp(pts[i], pts[i + 1], x - i);
};

type Pic = { v: number; w: number; h: number; tint?: boolean };

function Svg({ w, h, children }: { w: number; h: number; children: React.ReactNode }) {
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Time of day: a sun on its arc, a moon past "Later". v is -2..2. */
export function TimePic({ v, w, h, tint = true }: Pic) {
  const small = w < 50;
  const sr = small ? 4 : Math.max(6, h * 0.13);
  const cx = w / 2;
  const cy = h - (small ? 3 : 7);
  const r = Math.min(w / 2 - sr - 3, h - sr * 2 - 4);
  const th = Math.PI * (1 - (clamp(v, -2, 2) + 2) / 4);
  const x = cx + r * Math.cos(th);
  const y = cy - r * Math.sin(th);
  const moon = v > 1.2;
  const fg = tint ? null : "currentColor";
  return (
    <Svg w={w} h={h}>
      <path d={`M${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="var(--ink-4)" strokeWidth={small ? 1.5 : 1.8} strokeDasharray={small ? "1.5 2.5" : "2 4"} strokeLinecap="round" />
      <line x1={small ? 1 : 6} x2={w - (small ? 1 : 6)} y1={cy} y2={cy} stroke="var(--ink-4)" strokeWidth={1.2} />
      {moon ? (
        <>
          <circle cx={x} cy={y} r={sr} fill={fg ?? "var(--c3)"} />
          <circle cx={x + sr * 0.5} cy={y - sr * 0.4} r={sr * 0.85} fill="var(--paper-2)" />
        </>
      ) : (
        <circle cx={x} cy={y} r={sr} fill={fg ?? "#e0a52b"} />
      )}
    </Svg>
  );
}

/** Fewer days: classes stack into fewer columns as it matters more. */
export function DaysPic({ v, w, h, tint = true }: Pic) {
  const nd = clamp(Math.round(at(v, [5, 4, 4, 3, 2])), 1, 5);
  const on = [1, 3, 0, 2, 4].slice(0, nd).sort((a, b) => a - b);
  const cw = w / 5;
  const counts = [0, 0, 0, 0, 0];
  const hues: number[][] = [[], [], [], [], []];
  const hs = [3, 1, 2, 5, 6];
  for (let i = 0; i < 8; i++) {
    counts[on[i % nd]] += 1;
    hues[on[i % nd]].push(hs[i % 5]);
  }
  const top = h * 0.06;
  const colH = h * 0.88;
  const bh = colH / 4.4;
  const out: ReactElement[] = [];
  for (let d = 0; d < 5; d++) {
    out.push(<rect key={`c${d}`} x={d * cw + 1} y={top} width={cw - 2} height={colH} rx={2} fill={tint ? "var(--paper)" : "currentColor"} opacity={tint ? (counts[d] ? 1 : 0.45) : 0.12} />);
    for (let k = 0; k < counts[d]; k++) {
      out.push(<rect key={`b${d}-${k}`} x={d * cw + 1} y={top + 1 + k * (bh + 0.8)} width={cw - 2} height={bh} rx={1.5} fill={tint ? `var(--c${hues[d][k]})` : "currentColor"} opacity={tint ? 0.85 : 1} />);
    }
  }
  return <Svg w={w} h={h}>{out}</Svg>;
}

/** Short gaps: three classes closing up. */
export function GapsPic({ v, w, h, tint = true }: Pic) {
  const g = (at(v, [9, 6.5, 4.2, 2, 0.6]) * h) / 46;
  const L = h * 0.2;
  const y0 = (h - (3 * L + 2 * g)) / 2;
  const fills = tint ? ["var(--c3)", "var(--c1)", "var(--c2)"] : ["currentColor", "currentColor", "currentColor"];
  return (
    <Svg w={w} h={h}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={w * 0.18} y={y0 + i * (L + g)} width={w * 0.64} height={L} rx={Math.max(1.6, h / 26)} fill={fills[i]} opacity={tint ? 0.85 : 0.55 + i * 0.15} />
      ))}
    </Svg>
  );
}

/** Short walks: the second building moves closer. */
export function WalkPic({ v, w, h, tint = true }: Pic) {
  const t = clamp(v, 0, 4) / 4;
  const b = Math.min(w, h) * 0.24;
  const x2 = lerp(w - 4, w * 0.5, t);
  const y2 = lerp(h * 0.34, h * 0.56, t);
  const bc = tint ? "var(--ink-2)" : "currentColor";
  const pc = tint ? "var(--brand-2)" : "currentColor";
  const sw = Math.max(1.6, h / 22);
  return (
    <Svg w={w} h={h}>
      <rect x={4} y={h * 0.58} width={b} height={b} rx={1.5} fill={bc} />
      <rect x={x2 - b} y={y2 - b} width={b} height={b} rx={1.5} fill={bc} />
      <path d={`M${4 + b} ${h * 0.58 + b * 0.5} Q ${(x2 + 4) / 2} ${h * 0.98} ${x2 - b * 0.5} ${y2}`} fill="none" stroke={pc} strokeWidth={sw} strokeDasharray={`${sw} ${Math.max(2.4, h / 14)}`} strokeLinecap="round" />
    </Svg>
  );
}

function starPath(cx: number, cy: number, r1: number) {
  const r2 = r1 * 0.45;
  let p = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r2 : r1;
    p += `${i ? "L" : "M"}${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
  }
  return `${p}Z`;
}

/** Well-rated instructors: stars filling in. */
export function RatingPic({ v, w, h, tint = true }: Pic) {
  const lit = at(v, [0, 2, 3, 4, 5]);
  const gap = w / 5;
  const r1 = Math.min(gap * 0.42, h * 0.22);
  return (
    <Svg w={w} h={h}>
      {[0, 1, 2, 3, 4].map((i) => {
        const f = clamp(lit - i, 0, 1);
        const d = starPath(gap * (i + 0.5), h / 2, r1);
        return (
          <g key={i}>
            <path d={d} fill={tint ? "var(--paper)" : "none"} stroke={tint ? "var(--ink-4)" : "currentColor"} strokeWidth={1.2} strokeLinejoin="round" opacity={tint ? 1 : 0.5} />
            {f > 0 ? <path d={d} fill={tint ? "#e0a52b" : "currentColor"} opacity={f} /> : null}
          </g>
        );
      })}
    </Svg>
  );
}

export const LEAN_PIC: Record<LeanKey, (p: Pic) => ReactElement> = { time: TimePic, fewerDays: DaysPic, compact: GapsPic, walking: WalkPic, rating: RatingPic };

/** Card face sizes: Time of day spans two columns. */
export const CARD_SIZE: Record<LeanKey, [number, number]> = { time: [200, 56], fewerDays: [70, 46], compact: [40, 46], walking: [70, 46], rating: [70, 46] };

const ZONES: Array<[number, number, string]> = [
  [0, 12, "var(--paper-3)"],
  [12, 15, "var(--accent-soft)"],
  [15, 18, "var(--attention-soft)"],
  [18, 21, "var(--danger-soft)"],
];
/** The credit limit: the cart's credits as a bar, full time at 12, the limit as a post. */
export function CreditPic({ planned, max, w = 80, h = 26 }: { planned: number; max: number | null; w?: number; h?: number }) {
  const x = (c: number) => (Math.min(c, 21) / 21) * w;
  const y = h / 2 - 4;
  const cap = max ?? 21;
  return (
    <Svg w={w} h={h}>
      {ZONES.map(([a, b, c]) => (
        <rect key={a} x={x(a)} y={y} width={x(b) - x(a)} height={8} fill={c} />
      ))}
      <rect x={0} y={y} width={x(Math.min(planned, cap))} height={8} fill="var(--brand-2)" />
      {planned > cap ? <rect x={x(cap)} y={y} width={x(planned) - x(cap)} height={8} fill="var(--attention)" /> : null}
      <rect x={x(12) - 0.75} y={y - 3} width={1.5} height={14} fill="var(--ink-3)" />
      {max === null ? null : <rect x={x(cap) - 1.5} y={y - 6} width={3} height={20} rx={1.5} fill="var(--ink)" />}
    </Svg>
  );
}
