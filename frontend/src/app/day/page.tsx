import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { DayView } from "@/components/map/day-view";
import { startPlaces } from "@/components/map/start-places";
import { activeCampus, campusById } from "@/lib/campus/config";
import footprints from "@/lib/campus/data/buildings.json";

export const metadata: Metadata = { title: "Day" };

// The browser chrome takes the map's land color, so the status bar meets the map.
export const viewport: Viewport = { themeColor: "#eeede9" };

// Read here, on the server: the footprint file is large, the list of names is small.
const places = startPlaces(footprints, activeCampus.bounds);

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
  // The footprint file is UNT Denton's; other campuses have no starting points yet.
  return <DayView campusId={selected.id} places={selected.id === activeCampus.id ? places : []} />;
}
