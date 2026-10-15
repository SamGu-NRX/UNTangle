import type { Metadata } from "next";
import { headers } from "next/headers";
import { brandFor, hostIdFor } from "@/lib/brand";
import { WeekPage } from "./week-page";

type Search = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

async function brandOf(searchParams: Search) {
  const params = await searchParams;
  return brandFor(hostIdFor((await headers()).get("host"), first(params.host)));
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const brand = await brandOf(searchParams);
  return { title: brand.id === "vsb" ? brand.name : "Week" };
}

/** Week, or the standalone UNT Schedule Builder on its own host (lib/brand.ts). */
export default async function SchedulePage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  return <WeekPage hostId={(await brandOf(searchParams)).id} query={first(params.q)} week={first(params.week)} />;
}
