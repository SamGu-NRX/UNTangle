import type { Hue } from "@/lib/course-colors";

/**
 * The web app's --c1..--c6 tokens (frontend/src/app/globals.css) as concrete
 * colors for React Native styles: a solid block color and a pale tint for
 * its background.
 */
const HUE_COLORS: Record<Hue, { solid: string; tint: string }> = {
  1: { solid: "#3f7a4f", tint: "#e6f0e8" },
  2: { solid: "#a3613f", tint: "#f6ebe4" },
  3: { solid: "#4b6a8a", tint: "#e6ecf2" },
  4: { solid: "#8d7325", tint: "#f5f0e0" },
  5: { solid: "#7a5272", tint: "#f1e8f0" },
  6: { solid: "#3d7a7a", tint: "#e3f0f0" },
};

export function hueColor(hue: Hue | undefined) {
  return HUE_COLORS[hue ?? 1];
}
