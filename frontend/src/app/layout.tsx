import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/AppShell";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "@/components/ui/ui.css";
import "@/components/shell/shell.css";

/*
 * Fonts are self-hosted (src/app/fonts, OFL; files from Fontsource 5.3.0)
 * rather than fetched through next/font/google: that fetch runs at build
 * time and failed intermittently, breaking `next build` on a flaky network.
 * Weights, axes, variable names, display and preload match the earlier
 * Google setup.
 */

// Syne carries identity only (wordmark 800, course codes and figures 700),
// so only those two weights ship.
const syne = localFont({
  src: [
    { path: "./fonts/syne-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/syne-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-syne",
  display: "swap",
});

// Variable DM Sans with its optical-size axis (and weight 100–1000), so 11px
// labels and 18px titles each get the cut drawn for their size.
const dmSans = localFont({
  src: [{ path: "./fonts/dm-sans-latin-opsz-normal.woff2", weight: "100 1000", style: "normal" }],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "UNTangle", template: "%s · UNTangle" },
  description: "Plan a UNT semester: the courses you need, a week that fits, and the walk between classes.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "UNTangle", statusBarStyle: "default" },
  // The tab icon comes from app/icon.png (Next adds its link tag).
  icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
  other: { "apple-mobile-web-app-capable": "yes" },
};

// No maximum-scale: readers must be able to zoom. The theme color is
// --ground; the Day route overrides it with the map's land color.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f6f3",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable}`}>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
