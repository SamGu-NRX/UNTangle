import { StyleSheet, View } from "react-native";

import { color } from "@/theme/tokens";

/**
 * Small drawn glyphs. They are plain views so they render identically on
 * iOS, Android and web without an icon font or SVG dependency; each sits in
 * a fixed box so rows align on the text baseline the same way everywhere.
 */

function Check({ size, tint }: { size: number; tint: string }) {
  return (
    <View
      style={{
        width: size * 0.55,
        height: size * 0.3,
        borderLeftWidth: 2,
        borderBottomWidth: 2,
        borderColor: tint,
        transform: [{ translateY: -size * 0.06 }, { rotate: "-45deg" }],
      }}
    />
  );
}

export type GlyphStatus = "done" | "taking" | "planned" | "available" | "locked";

/** The Courses status glyphs (DESIGN.md §8.2), 18px, one family so a list reads as its own legend. */
export function StatusGlyph({ status, size = 18 }: { status: GlyphStatus; size?: number }) {
  const ring = { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" } as const;
  switch (status) {
    case "done":
      return (
        <View style={[ring, { backgroundColor: color.ink2 }]}>
          <Check size={size * 0.62} tint="#fff" />
        </View>
      );
    case "taking":
      return (
        <View style={[ring, { borderWidth: 1.5, borderColor: color.accent }]}>
          <View style={{ width: size * 0.4, height: size * 0.4, borderRadius: size, backgroundColor: color.accent }} />
        </View>
      );
    case "planned":
      return (
        <View style={[ring, { backgroundColor: color.brand }]}>
          <View style={{ width: size * 0.3, height: size * 0.3, borderRadius: size, backgroundColor: "#fff" }} />
        </View>
      );
    case "available":
      return <View style={[ring, { borderWidth: 1.5, borderColor: color.ink4 }]} />;
    case "locked":
      return <View style={[ring, { borderWidth: 1.5, borderColor: color.ink4, borderStyle: "dashed" }]} />;
  }
}

/** Plus and minus for the one-tap add and remove buttons. */
export function PlusGlyph({ size = 14, tint = color.brand, minus = false }: { size?: number; tint?: string; minus?: boolean }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ position: "absolute", width: size, height: 2, borderRadius: 1, backgroundColor: tint }} />
      {minus ? null : <View style={{ position: "absolute", width: 2, height: size, borderRadius: 1, backgroundColor: tint }} />}
    </View>
  );
}

export function CloseGlyph({ size = 14, tint = color.ink2 }: { size?: number; tint?: string }) {
  const bar = { position: "absolute", width: size * 1.2, height: 2, borderRadius: 1, backgroundColor: tint } as const;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={[bar, { transform: [{ rotate: "45deg" }] }]} />
      <View style={[bar, { transform: [{ rotate: "-45deg" }] }]} />
    </View>
  );
}

/** A chevron that turns to show a group open or closed. */
export function Chevron({ open, tint = color.ink3 }: { open: boolean; tint?: string }) {
  return (
    <View style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 7,
          height: 7,
          borderRightWidth: 1.75,
          borderBottomWidth: 1.75,
          borderColor: tint,
          transform: [{ translateY: open ? -2 : 0 }, { rotate: open ? "45deg" : "-45deg" }],
        }}
      />
    </View>
  );
}

export function LockGlyph({ size = 12, tint = color.ink2 }: { size?: number; tint?: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }}>
      <View
        style={{
          position: "absolute",
          top: 0,
          width: size * 0.56,
          height: size * 0.6,
          borderWidth: 1.5,
          borderBottomWidth: 0,
          borderColor: tint,
          borderTopLeftRadius: size,
          borderTopRightRadius: size,
        }}
      />
      <View style={{ width: size * 0.84, height: size * 0.56, borderRadius: 2, backgroundColor: tint }} />
    </View>
  );
}

/** Two slider rails with knobs: the Preferences button. */
export function SlidersGlyph({ tint = color.brand }: { tint?: string }) {
  const rail = { height: 1.75, borderRadius: 1, backgroundColor: tint, width: 16 } as const;
  const knob = { position: "absolute", width: 6, height: 6, borderRadius: 3, borderWidth: 1.75, borderColor: tint, backgroundColor: color.paper, top: -2.25 } as const;
  return (
    <View style={{ width: 16, height: 14, justifyContent: "space-between", paddingVertical: 2.5 }}>
      <View style={rail}>
        <View style={[knob, { left: 2 }]} />
      </View>
      <View style={rail}>
        <View style={[knob, { left: 9 }]} />
      </View>
    </View>
  );
}

/** A head over shoulders, 16px: Sign in where the header has no room for the word, as the web's phone header shows it. */
export function PersonGlyph({ tint = color.brand }: { tint?: string }) {
  return (
    <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, borderWidth: 1.75, borderColor: tint }} />
      <View
        style={{
          width: 13,
          height: 6.5,
          borderWidth: 1.75,
          borderBottomWidth: 0,
          borderColor: tint,
          borderTopLeftRadius: 7,
          borderTopRightRadius: 7,
        }}
      />
    </View>
  );
}

type TabName = "courses" | "week" | "day";

/** Tab bar glyphs, 22px boxes: a list, a week grid, a route between two stops. */
export function TabGlyph({ name, active }: { name: TabName; active: boolean }) {
  const tint = active ? color.brand : color.ink2;
  const w = active ? 2 : 1.6;
  if (name === "courses") {
    return (
      <View style={styles.tab}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={styles.listRow}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: tint }} />
            <View style={{ flex: 1, height: w, borderRadius: 1, backgroundColor: tint }} />
          </View>
        ))}
      </View>
    );
  }
  if (name === "week") {
    return (
      <View style={[styles.tab, { borderWidth: w, borderColor: tint, borderRadius: 5, padding: 3, gap: 2, justifyContent: "flex-start" }]}>
        <View style={{ height: w, backgroundColor: tint, marginBottom: 2 }} />
        <View style={{ flexDirection: "row", gap: 3 }}>
          <View style={{ flex: 1, height: 5, borderRadius: 1.5, backgroundColor: tint }} />
          <View style={{ flex: 1 }} />
          <View style={{ flex: 1, height: 8, borderRadius: 1.5, backgroundColor: tint }} />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.tab, { alignItems: "center" }]}>
      <View style={{ width: 7, height: 7, borderRadius: 4, borderWidth: w, borderColor: tint, alignSelf: "flex-start", marginLeft: 1 }} />
      <View style={{ position: "absolute", width: 12, height: w, backgroundColor: tint, transform: [{ rotate: "-45deg" }] }} />
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tint, alignSelf: "flex-end", marginRight: 1 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { width: 22, height: 22, justifyContent: "space-between", paddingVertical: 3 },
  listRow: { flexDirection: "row", alignItems: "center", gap: 4 },
});
