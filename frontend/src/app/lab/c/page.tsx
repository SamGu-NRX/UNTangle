import type { Metadata } from "next";
import { DirectionC } from "@/components/lab/direction-c";
import "../lab.css";

export const metadata: Metadata = {
  title: "UNTangle · Direction C — map + bottom sheet",
  description: "Round-1 direction C: map-first with a snapping bottom sheet.",
};

export default function LabDirectionCPage() {
  return <DirectionC />;
}
