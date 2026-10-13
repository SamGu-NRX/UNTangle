import type { Metadata } from "next";
import { Syne, DM_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-display-syne",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  // The variable request returns direct WOFF2 URLs. Static-weight Google URLs
  // contain query parameters that Next 16.1.6 Turbopack fails to parse.
  weight: "variable",
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "UNTangle",
  description: "Schedule optimizer and campus routing flow for UNT students.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
