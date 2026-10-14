import type { Metadata } from "next";
import { PrintPage } from "./print-page";

export const metadata: Metadata = { title: "Print week" };

export default function SchedulePrintPage() {
  return <PrintPage />;
}
