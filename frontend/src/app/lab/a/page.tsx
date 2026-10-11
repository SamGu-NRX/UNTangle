import type { Metadata } from "next";
import { DirectionA } from "@/components/lab/direction-a";
import "../lab.css";

export const metadata: Metadata = {
  title: "UNTangle · Direction A — week grid + day map",
  description: "Round-1 direction A: the week grid with a live per-leg day route panel.",
};

export default function LabDirectionAPage() {
  return <DirectionA />;
}
