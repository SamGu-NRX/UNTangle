import type { Hue } from "@/lib/course-colors";

/**
 * UNTangle v3 tokens for React Native. The values are the web app's
 * (frontend/src/app/globals.css, the first :root block), so a screen here and
 * the same screen on the web read as one product. When a value changes there,
 * change it here; tokens.test.ts pins the ones a student can see.
 */

export const color = {
  ground: "#f4f6f3",
  paper: "#ffffff",
  paper2: "#eef2ed",
  paper3: "#e5ebe4",
  line: "#dde6dc",
  line2: "#c5d3c4",
  /** Titles and codes. */
  ink: "#1a2e1a",
  /** Body and meta: the lightest color text may use. */
  ink2: "#4f654f",
  /** Glyphs and placeholders only, never text. */
  ink3: "#6b806b",
  /** Disabled and decorative. */
  ink4: "#9fb09f",
  brand: "#00512b",
  brand2: "#007a40",
  brandSoft: "#e3efe6",
  /** Focus ring, taking, selected: never text. */
  accent: "#00a855",
  accentSoft: "#dff5e8",
  attention: "#8a6100",
  attentionSoft: "#fbf3df",
  danger: "#b3261e",
  dangerSoft: "#fbeae8",
  scrim: "rgba(16, 32, 18, 0.36)",
} as const;

/** Course colors, assigned by department (lib/course-colors.ts). Never text under 14px. */
export const hues: Record<Hue, { solid: string; tint: string }> = {
  1: { solid: "#3f7a4f", tint: "#e6f0e8" },
  2: { solid: "#a3613f", tint: "#f6ebe4" },
  3: { solid: "#4b6a8a", tint: "#e6ecf2" },
  4: { solid: "#8d7325", tint: "#f5f0e0" },
  5: { solid: "#7a5272", tint: "#f1e8f0" },
  6: { solid: "#3d7a7a", tint: "#e3f0f0" },
};

export function hueOf(hue: Hue | undefined) {
  return hues[hue ?? 1];
}

/**
 * Font families as loaded in app/_layout.tsx. React Native picks a static
 * face by family name, so each weight is its own family. Syne is for the
 * wordmark only; every other word, code and figure is DM Sans.
 */
export const font = {
  regular: "DMSans_400Regular",
  medium: "DMSans_500Medium",
  semibold: "DMSans_600SemiBold",
  bold: "DMSans_700Bold",
  wordmark: "Syne_800ExtraBold",
} as const;

/**
 * The web type scale with phone adjustments from DESIGN.md §6: body is 15 on
 * phones, inputs 16 so iOS never zooms. Label is the 11px caps label.
 */
export const type = {
  label: { fontFamily: font.semibold, fontSize: 11, lineHeight: 16, letterSpacing: 0.66, textTransform: "uppercase" },
  meta: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: font.semibold, fontSize: 15, lineHeight: 21 },
  code: { fontFamily: font.bold, fontSize: 14, lineHeight: 19 },
  input: { fontFamily: font.regular, fontSize: 16, lineHeight: 22 },
  title: { fontFamily: font.semibold, fontSize: 18, lineHeight: 24, letterSpacing: -0.09 },
  h1: { fontFamily: font.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.26 },
  /** The leave-by figure on Day: the one big number in the app. */
  numeral: { fontFamily: font.bold, fontSize: 44, lineHeight: 48, letterSpacing: -0.88 },
  wordmark: { fontFamily: font.wordmark, fontSize: 19, lineHeight: 24 },
} as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;

export const radius = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

/** Green-tinted, quiet elevation. `boxShadow` renders on iOS, Android and web under the New Architecture. */
export const shadow = {
  1: "0 1px 2px rgba(20, 40, 22, 0.07)",
  2: "0 6px 16px -4px rgba(20, 40, 22, 0.12), 0 1px 3px rgba(20, 40, 22, 0.07)",
  3: "0 24px 48px -12px rgba(20, 40, 22, 0.22), 0 4px 10px rgba(20, 40, 22, 0.08)",
} as const;

/** Phone layout constants (DESIGN.md §5): 12px list gutters, 44px minimum targets. */
export const layout = {
  gutter: 16,
  target: 44,
  tabBar: 56,
  header: 52,
  /** One hour on the phone Week grid. */
  hour: 56,
} as const;

/**
 * Motion (MOTION.md §2 and globals.css). Curves are the web's cubic-beziers;
 * durations are the web's in milliseconds. Springs use Reanimated's
 * duration and dampingRatio form for anything a finger releases.
 * Plain data, so tests can read it without loading Reanimated.
 */
export const motion = {
  /** CSS strings for Reanimated CSS transitions; the worklet curves are in easing.ts. */
  css: {
    easeOut: "cubic-bezier(0.23, 1, 0.32, 1)",
    easeInOut: "cubic-bezier(0.77, 0, 0.175, 1)",
  },
  press: 120,
  hover: 160,
  enter: 220,
  exit: 150,
  swap: 160,
  /** A drag released onto a detent or slider stop: settles without overshoot. */
  settle: { duration: 300, dampingRatio: 1 },
  /** A flicked control snapping to its stop, carrying the finger's velocity. */
  snap: { duration: 300, dampingRatio: 0.8 },
} as const;
