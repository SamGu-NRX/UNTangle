import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { MapClient } from "@/components/map-client";
import { campusById } from "@/lib/campus/config";

export const metadata: Metadata = { title: "Day" };

// The browser chrome takes the map's land color, so the status bar meets the map.
export const viewport: Viewport = { themeColor: "#eeede9" };

export default async function DayPage({
  searchParams,
}: {
  searchParams: Promise<{ campus?: string | string[] }>;
}) {
  const { campus } = await searchParams;
  if (Array.isArray(campus)) notFound();
  let selected;
  try {
    selected = campusById(campus);
  } catch {
    notFound();
  }
  return <MapClient campusId={selected.id} />;
}
