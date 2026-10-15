import { Text, type TextProps, type TextStyle } from "react-native";

import { color, type as typeScale } from "@/theme/tokens";

type Variant = keyof typeof typeScale;

/**
 * Every word in the app goes through Txt so the type scale stays the web's.
 * `tone` picks from the three text inks; ink-3 and ink-4 are glyph colors and
 * not offered here.
 */
export function Txt({
  variant = "body",
  tone = "ink",
  style,
  ...rest
}: TextProps & { variant?: Variant; tone?: "ink" | "ink2" | "brand" | "danger" | "attention" | "white" }) {
  const toneColor = tone === "white" ? "#ffffff" : color[tone];
  return (
    <Text
      {...rest}
      style={[typeScale[variant] as TextStyle, { color: toneColor, fontVariant: ["tabular-nums"] }, style]}
    />
  );
}
