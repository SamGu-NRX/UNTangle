import type { Metadata } from "next";
import { DirectionB } from "@/components/lab/direction-b";
import "../../../components/lab/lab.css";

export const metadata: Metadata = {
  title: "UNTangle · Direction B — day itinerary",
  description: "Round-1 direction B: a day-first itinerary with walking legs inline.",
};

export default function LabDirectionBPage() {
  return <DirectionB />;
}
