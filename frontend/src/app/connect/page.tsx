import type { Metadata } from "next";
import { ImportPage } from "@/components/connect/import-page";

export const metadata: Metadata = { title: "Import your transcript" };

export default function ConnectPage() {
  return <ImportPage />;
}
