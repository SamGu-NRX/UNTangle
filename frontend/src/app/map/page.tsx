import { MapClient } from "@/components/map-client";
import { campusById } from "@/lib/campus/config";
import { notFound } from "next/navigation";

export default async function MapPage({
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
